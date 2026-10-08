# Psychometric methodology

This document describes how the assessment is designed and scored, states
every psychometric assumption it makes, and lists its limitations. The short,
participant-facing version is the `/methodology` page.

**Status.** Research preview. Original items, a complete adaptive engine and
scoring model — and no empirical evidence yet. No item has been calibrated on
real participants; there is no norm sample; reliability and validity have not
been studied. All scores are therefore *provisional* and are never presented as
IQ scores.

---

## 1. Measurement framework

### 1.1 Theoretical model

The assessment follows the Cattell–Horn–Carroll (CHC) model (Carroll, 1993;
Schneider & McGrew, 2018): a general factor (*g*) above broad abilities, each
defined by narrower abilities. Six broad abilities are sampled:

| Broad ability | Narrow abilities targeted | Families |
|---|---|---|
| Fluid reasoning (Gf) | Induction (I), general sequential reasoning (RG) | matrices, figure series, deduction (ordering, syllogisms, conditionals) |
| Visual-spatial processing (Gv) | Visualization (Vz) | 2D rotation, 3D rotation, paper folding |
| Quantitative reasoning (Gq) | Quantitative reasoning (RQ) | number series, number matrices, balance problems |
| Working memory (Gwm) | Wa, Wv, attentional control (AC) | digit span forward/backward, digit–letter reordering, spatial span |
| Processing speed (Gs) | Perceptual speed (P) | symbol search, visual comparison |
| Crystallised ability (Gc) | Lexical knowledge (VL), language development (LD) | vocabulary, analogies, classification |

Note on terminology: in CHC, *quantitative reasoning* (RQ) is a narrow ability
under Gf, while Gq denotes quantitative *knowledge*. The "Gq" section here
deliberately measures quantitative reasoning with minimal knowledge demands
(whole numbers, four operations, no algebraic notation). It will correlate
with Gf; whether it forms a separable factor is an empirical question for the
validation study.

### 1.2 Design references and originality

Established batteries informed the *structure* (multiple indexes, separate
domain scores, a composite only with justification) and matrix-reasoning tests
informed the *paradigm*. No item, item format specification, scoring rule or
norm from any published or proprietary test was used. All items were
generated or written for this project; the generators and their rules are in
the source code.

---

## 2. Item bank

See [ITEM_BANK.md](ITEM_BANK.md) for the full specification. In brief:

- **Rule-based generation** for figural, spatial, quantitative and deductive
  items, after the cognitive design system approach (Embretson, 1998) and
  automatic matrix generation (Matzen et al., 2010).
- **Independent verification** of every key by a separate solver, plus tests
  that no context-blind shortcut (most typical option, odd one out, most
  symmetric option) beats chance.
- **Frozen, versioned content**: the bank is stored as JSON with a SHA-256
  hash per item; regenerating must reproduce it exactly.
- **A priori difficulty** from documented complexity models (Section 3.2).

Logical correctness is *not* psychometric validity. Verification establishes
that each item has one defensible answer; difficulty, discrimination, bias and
construct validity can only be learned from real responses.

---

## 3. Item response model

### 3.1 Response function

All items are modelled with the three-parameter logistic function on the
logistic metric:

  P(correct | θ) = c + (1 − c) / (1 + exp(−a(θ − b)))

with Fisher information I(θ) = a² · ((P − c)² / (1 − c)²) · ((1 − P) / P).

### 3.2 Provisional parameters (used today)

No empirical parameters exist, so the engine uses an explicitly provisional
parameterisation (`src/lib/psychometrics/parameters.ts`):

| Parameter | Provisional value | Status |
|---|---|---|
| b (difficulty) | the item's a priori complexity-model logit | expert-judgement model, not estimated |
| a (discrimination) | 1 for every item | no information available |
| c (lower asymptote) | 1/k for k-option items, 0 for free response | logical bound for blind guessing, not estimated |

The a priori logit comes from a linear complexity model per family (an
LLTM-style specification; Fischer, 1973) with weights chosen by expert
judgement, informed by research on what makes items hard (Carpenter, Just &
Shell, 1990; Primi, 2001; Shepard & Metzler, 1971). Levels 1–5 are bands of
this logit centred on −2, −1, 0, 1 and 2.

These parameters are good enough to order items and to steer selection. They
are not calibrated parameters and are never described as such.

### 3.3 Calibrated parameters (future)

A `CalibrationSet` (2PL or 3PL; fitted, for example, with R `mirt`) can be
loaded per item **and version**. Parameter resolution is all-or-nothing per
section: a domain estimate counts as *calibrated* only if every response in it
used parameters from the same calibration set. Validation rejects malformed
sets (non-positive a, c outside [0, 1), missing sample sizes, keys without
versions).

---

## 4. Adaptive administration

### 4.1 Item selection

- **Start:** the ability estimate starts at the prior mean (θ = 0), so the
  first item is of medium difficulty (tested).
- **Criterion:** maximum Fisher information at the current estimate (Lord,
  1980; Weiss, 1982). Because the EAP estimate rises after every correct
  answer and falls after every error (a property proven by the monotone
  likelihood ratio and checked by tests), difficulty follows performance.
- **Content balancing:** the family whose administered share lags its target
  most is chosen next (Kingsbury & Zara, 1989). Targets: Gf matrix 50% /
  series 25% / deduction 25%; Gv 35/30/35; Gq series 45 / balance 30 /
  matrices 25; Gc vocabulary 40 / analogy 35 / classification 25.
- **Exposure control:** randomesque selection among the three most
  informative eligible items (Kingsbury & Zara, 1989).

### 4.2 Estimation

Expected a posteriori (EAP) estimation with a N(0, 1) prior on a 121-point
quadrature grid from −6 to 6 (Bock & Mislevy, 1982). The posterior standard
deviation is reported as the standard error. EAP is defined for all response
patterns, including all-correct and all-wrong, but **shrinks toward the prior
mean**; Section 7 quantifies this. MLE (Fisher scoring) is implemented for
comparison.

### 4.3 Stopping

| Section | Min items | Max items | Target SE | Time budget |
|---|---:|---:|---:|---:|
| Quick · Gf | 12 | 22 | 0.30 | 18 min |
| Full · Gf | 8 | 13 | 0.40 | 13 min |
| Full · Gv | 6 | 10 | 0.45 | 9 min |
| Full · Gq | 6 | 10 | 0.45 | 10 min |
| Full · Gc | 8 | 14 | 0.40 | 8 min |

With provisional parameters the target SE is rarely reached, so sections
usually end at the maximum length. The reported SE is honest about this.

### 4.4 Working memory

Span tasks use the conventional ascending procedure: two trials per length,
starting at 3 (forward, spatial) or 2 (backward, reordering), ending when both
trials of a length are failed. Elements are shown visually, one per second
(800 ms on, 200 ms off), because audio cannot be assumed in a browser. The
domain estimate pools all span trials in one EAP estimate, with a priori
difficulty 0.85 × (length − centre). Raw longest spans are reported too.

### 4.5 Processing speed

Two 60-second blocks, scored as (correct − incorrect) per minute. Timing:

- the monotonic clock (`performance.now()`), never wall-clock time;
- stimulus onset is taken from the first painted frame (double
  `requestAnimationFrame`);
- response timestamps come from the input event (`event.timeStamp`);
- a 6-trial simple-reaction baseline on the same device is subtracted from
  median response times;
- leaving the page restarts the block;
- the display frame interval and input modality are recorded.

Browser timing is accurate to roughly a frame plus device input latency
(Bridges et al., 2020; Anwyl-Irvine et al., 2021). Speed scores are never
compared across devices and are not placed on the IRT scale.

### 4.6 Time limits and response validity

Reasoning and knowledge items have generous per-item limits (45 s for vocabulary up to 150 s for matrices and deduction). A time-out is scored
as incorrect. Active time excludes time the page was hidden; an interrupted
item resumes with the time already spent (and is flagged). Responses faster
than 10% of the item's expected time (bounded to 1.5–10 s) are flagged as
rapid guesses (Wise & Kong, 2005). Validity indicators — rapid responses,
time-outs, window changes, interruptions, reaction-time anticipations — are
summarised on the results page.

---

## 5. Scoring

### 5.1 Development scoring (what is reported)

`src/lib/scoring/development.ts`

- Provisional θ, SE and 95% interval per IRT-scored domain, translated to the
  five difficulty levels of the bank (the level whose band contains θ is the
  difficulty the person would solve about half the time).
- Raw statistics: items, correct, hardest level solved, median response time,
  longest spans, items per minute, baseline-adjusted response time.
- **Within-person profile** (`profile.ts`): a domain is a relative strength
  or weakness only if its deviation from the person's mean exceeds 1.96
  standard errors, with Var(θ_d − mean) = SE_d²(1 − 2/k) + ΣSE_j²/k². Flagged
  as tentative, because cross-domain comparison assumes comparable
  provisional scales.
- **No** IQ, z-score, percentile, "above average" or any normative label.
  A unit test asserts that the report contains no such quantities.
- Raw accuracy is reported with the explanation that it is not an ability
  measure in an adaptive test.
- A general-ability (g) composite is **not** computed: combining uncalibrated
  domain estimates into a composite would need factor-analytic evidence that
  does not exist.

### 5.2 Validated scoring (implemented, locked)

`src/lib/scoring/validated.ts`

With a validated `NormTable` (age bands with θ means and SDs per domain, a
composite definition with structural-validity evidence, reliabilities):

  z = (θ − μ_age) / σ_age  IQ = 100 + 15·z

- Domain confidence intervals use the conditional IRT standard error:
  SE_IQ = 15 · SE_θ / σ_age.
- The composite (full-scale) score uses the weighted sum of domain z-scores,
  re-standardised with the composite's norms, and SEM = 15 · √(1 − r_xx).
- Percentiles assume normality of the normed scores (an empirical lookup can
  replace this).
- Scores outside the norm table's supported range are shown at the limit and
  flagged.

`checkNormEligibility` refuses to produce any of this unless **all** hold: a
validated norm table; an empirical calibration whose id matches the norms; all
responses scored with that calibration; the normed bank version and mode; a
stated age within the normed range; standard administration (no extended
time); a completed assessment; and acceptable response validity. The shipped
registry (`src/lib/norms/registry.ts`) is empty, so the results page shows the
locked state with the reasons. The pipeline is tested only with fixtures named
`FIXTURE_NOT_REAL_*`, and a test fails if application code imports them.

---

## 6. Assumptions (complete list)

1. CHC broad abilities are appropriate targets, and the item families sample
   them (construct representation; untested).
2. Each section is unidimensional enough for a single θ (untested).
3. The a priori complexity models order item difficulty roughly correctly
   within a family (untested; LLTM check in the pilot).
4. All items discriminate equally (a = 1) — almost certainly false; the
   simulation (condition B) estimates the cost.
5. The guessing floor equals 1/k — a logical bound; real floors are often
   lower because distractors attract.
6. Local independence of responses — doubtful for span trials within a task.
7. The prior N(0, 1) describes the population on the provisional scale —
   arbitrary; it determines the amount of shrinkage.
8. Provisional scales of different domains are commensurate (needed only for
   the within-person profile; flagged as tentative).
9. Visual presentation of span tasks measures working memory comparably to
   auditory presentation (unknown).
10. Unproctored, self-paced browser administration yields effortful,
    unaided responses (partly monitored with validity indicators).
11. Verbal items have one best answer for proficient English readers (expert
    review pending).

## 7. Precision (simulated)

[SIMULATION_REPORT.md](SIMULATION_REPORT.md) runs simulated test-takers
through the real engine. Summary, with responses following the assumed model:
marginal reliability 0.77 (quick Gf, ~21 items), 0.57–0.68 for the 10–14-item
full-mode reasoning and knowledge sections, 0.85 for working memory (pooled,
optimistic). In the middle of the scale the reported 95% intervals cover the
true value about 95% of the time; beyond |θ| ≈ 2 estimates are pulled strongly
toward the middle (bias up to ~1.6 logits at θ = ±3) and intervals are too
narrow. **This is simulation under assumed models, not validation.**

## 8. Limitations

- No calibration, norms, reliability or validity evidence.
- Short sections with modest precision; strong shrinkage at the extremes and
  a thinner bank at the top and bottom (floor/ceiling effects).
- Provisional model ignores differences in discrimination and guessing.
- English-only, culturally loaded verbal section.
- Visual items require normal or corrected vision.
- Unproctored online testing; practice effects on retest with the same bank.
- Device-dependent speed scores; visual (not auditory) memory spans.
- Answer keys are shipped to the browser: suitable for low-stakes use only.
- Order effects of the fixed section sequence are unknown.

## 9. Ethical safeguards in the product

- Consent checkbox before starting; plain-language statements that results
  are provisional, not an IQ and not a diagnosis.
- Data stay on the device; export is manual and limited to sessions with
  research consent; no identifying fields are collected.
- No labels such as "gifted" or "below average"; no population comparisons.
- Answer review is behind a warning about practice effects.
- Accessibility: keyboard operation, screen-reader labels, larger text, high
  contrast, reduced motion, optional extended time (flagged non-standard).

## References

See the reference list on the `/methodology` page (also used here):
AERA, APA & NCME (2014); Anwyl-Irvine et al. (2021); Birnbaum (1968);
Bock & Mislevy (1982); Bridges et al. (2020); Carpenter, Just & Shell (1990);
Carroll (1993); Chalmers (2012); Condon & Revelle (2014); De Ayala (2009);
Ekstrom et al. (1976); Embretson (1998); Embretson & Reise (2000);
Fischer (1973); Holland & Thayer (1988); Hu et al. (2021); Kingsbury & Zara
(1989); Kolen & Brennan (2014); Lenhard et al. (2018); Lord (1980); Matzen et
al. (2010); Neisser et al. (1996); Primi (2001); Schneider & McGrew (2018);
Shepard & Metzler (1971); van der Linden & Glas (2010); Weiss (1982);
Wise & Kong (2005).
