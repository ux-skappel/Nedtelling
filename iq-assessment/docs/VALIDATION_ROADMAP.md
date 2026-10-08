# Roadmap: from provisional to validated scores

The application is built so that real evidence can be added without
rewriting it. This roadmap lists the studies needed, what each produces, and
where its output plugs into the code. Sample sizes are planning figures based
on commonly cited guidance (e.g. De Ayala, 2009) and must be confirmed with a
power/precision analysis for the actual design. All studies with human
participants need ethics approval, informed consent and a data-protection
plan (for EU/EEA participants, a GDPR legal basis and a DPIA).

## Phase 0 — Expert review (no participants)

- Review every item for clarity, single correct answer, cultural and
  linguistic fairness, and accessibility; prioritise the hand-written verbal
  items. Record decisions per `id@version`.
- Review the a priori complexity models and the blueprint (content balance,
  section order, time limits).
- **Output:** revised items (new versions), bank 1.1.0.

## Phase 1 — Pilot (≈ 200–400 adults)

- Fixed forms (not adaptive), spanning all levels, with think-aloud sessions
  for a small subsample.
- Classical item analysis: proportion correct, corrected item–rest
  correlation (`classicalItemAnalysis`), distractor choice frequencies,
  response times, rapid-guessing rates.
- LLTM / explanatory IRT check of the complexity models: do the rule features
  predict difficulty?
- Usability, device and timing checks; time-limit calibration.
- **Output:** items flagged for revision or removal; data-based difficulty
  model weights; bank 1.2.0.

## Phase 2 — Calibration (≈ 1,000–3,000 adults)

- Linked multi-form or random-subset design so every item is answered by
  several hundred people (more for 3PL; several hundred is usually adequate
  for Rasch/2PL).
- Fit 2PL (choice items possibly 3PL) per domain with marginal maximum
  likelihood in validated software, e.g. R `mirt` (Chalmers, 2012), using the
  long-format export from the app (`toLongFormat` / "Export research data").
- Check dimensionality (CFA/bifactor), item fit, local dependence (especially
  span trials — consider testlet models), parameter drift between forms.
- Fix the scale (e.g. N(0, 1) in the calibration sample) and document it.
- **Output:** a `CalibrationSet` JSON keyed by `id@version`:

  ```json
  {
    "id": "cal-2027-01",
    "status": "empirical",
    "model": "2PL",
    "bankVersion": "1.2.0",
    "estimation": "R mirt 1.4x, MML-EM",
    "sampleSize": 2140,
    "population": "...",
    "collectedFrom": "2027-01-10",
    "collectedTo": "2027-04-30",
    "scaleDefinition": "θ ~ N(0,1) in the calibration sample",
    "modelChecks": ["M2 / RMSEA per domain", "S-X² item fit", "Q3 local dependence"],
    "items": { "GF-MX-001@1": { "a": 1.31, "b": 0.42, "n": 512 } }
  }
  ```
  Load it in `src/lib/norms/registry.ts` as `ACTIVE_CALIBRATION`. The engine
  then selects and scores with calibrated parameters; sessions record the
  calibration id; development scoring reports `parameterStatus: calibrated`.

## Phase 3 — Fairness

- Differential item functioning by sex, age group, first language, education
  and device (`mantelHaenszel`, ETS A/B/C), followed by IRT-based DIF tests and
  expert review of flagged items.
- Measurement invariance of the domain structure across groups.
- **Output:** items removed or revised; documented DIF review.

## Phase 4 — Norming (representative, age-stratified sample)

- Sampling plan stratified by age (e.g. 16–19, 20–24, …, 80+), sex, region,
  education and other census variables of the target population; standardised
  administration conditions (supervised or carefully controlled online).
- Continuous norming across age (e.g. Lenhard et al., 2018) rather than
  isolated age-band tables.
- Composite (full-scale) score only if structural evidence supports it;
  define weights and report composite reliability.
- **Output:** a `NormTable` JSON (see `src/lib/norms/types.ts`), validated by
  `validateNormTable`, loaded as `ACTIVE_NORM_TABLE`. From then on the results
  page shows standard scores, confidence intervals and age-adjusted
  percentiles for eligible sessions.

## Phase 5 — Reliability and validity

- Reliability: marginal reliability of adaptive scores, conditional SEM
  across θ, test–retest stability (with an interval long enough to limit
  practice effects).
- Validity: convergent and discriminant correlations with established
  instruments administered under licence by qualified examiners;
  criterion relations (e.g. education); structural validity of the CHC model.
- Documentation following the Standards for Educational and Psychological
  Testing (AERA, APA, & NCME, 2014).

## Phase 6 — Operations

- Re-norm on a schedule (score norms drift over time).
- Monitor item exposure and parameter drift; refresh the bank.
- For higher-stakes use: server-side scoring (no keys in the browser),
  identity and proctoring arrangements, and an independent review.

## What the code already provides

| Need | Where |
|---|---|
| Calibration import with validation | `lib/psychometrics/parameters.ts` |
| Norm table model and validation | `lib/norms/types.ts` |
| Guarded norm-referenced scoring | `lib/scoring/validated.ts` |
| Consent-aware long-format export | `lib/norms/analysis.ts` → `toLongFormat`, `toCsv`; "Export research data" on `/history` |
| Reliability, item analysis, DIF | `lib/norms/analysis.ts` |
| Item flags reported by participants | `session.itemFlags` |
| Simulation of new designs | `lib/simulation/study.ts`, `npm run simulate` |
