import type { Metadata } from "next";
import Link from "next/link";
import bankJson from "@/data/item-bank.json";
import summary from "@/data/simulation-summary.json";
import { SimulationBiasChart } from "@/components/methodology/simulation-chart";
import { WhatIqMeasures } from "@/components/results/what-iq-measures";
import { FULL_BLUEPRINT, QUICK_BLUEPRINT } from "@/lib/assessment/blueprint";
import { DOMAIN_LABELS, type Domain, type ItemBank } from "@/lib/items/types";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How the assessment is built and scored, what its scores mean, and what would be needed to validate it.",
};

const bank = bankJson as unknown as ItemBank;

const FAMILY_NOTES: { domain: Domain; narrow: string; families: string }[] = [
  { domain: "Gf", narrow: "Induction (I), general sequential reasoning (RG)", families: "3×3 figural matrices, figure series, linear-order, syllogism and conditional reasoning" },
  { domain: "Gv", narrow: "Visualization (Vz)", families: "2D mental rotation, 3D cube-figure rotation, paper folding" },
  { domain: "Gq", narrow: "Quantitative reasoning (RQ)", families: "Number series (free response), number matrices (free response), balance-scale substitution" },
  { domain: "Gwm", narrow: "Working memory capacity (Wa, Wv), attentional control (AC)", families: "Digits forward and backward, digit–letter reordering, spatial sequences" },
  { domain: "Gs", narrow: "Perceptual speed (P)", families: "Symbol search, visual comparison (60 s each)" },
  { domain: "Gc", narrow: "Lexical knowledge (VL), language development (LD)", families: "Vocabulary, verbal analogies, odd-one-out classification" },
];

const REFERENCES = [
  "AERA, APA, & NCME (2014). Standards for educational and psychological testing. American Educational Research Association.",
  "Anwyl-Irvine, A., Dalmaijer, E. S., Hodges, N., & Evershed, J. K. (2021). Realistic precision and accuracy of online experiment platforms, web browsers, and devices. Behavior Research Methods, 53, 1407–1425.",
  "Birnbaum, A. (1968). Some latent trait models and their use in inferring an examinee's ability. In F. M. Lord & M. R. Novick, Statistical theories of mental test scores. Addison-Wesley.",
  "Bock, R. D., & Mislevy, R. J. (1982). Adaptive EAP estimation of ability in a microcomputer environment. Applied Psychological Measurement, 6(4), 431–444.",
  "Bridges, D., Pitiot, A., MacAskill, M. R., & Peirce, J. W. (2020). The timing mega-study: Comparing a range of experiment generators, both lab-based and online. PeerJ, 8, e9414.",
  "Carpenter, P. A., Just, M. A., & Shell, P. (1990). What one intelligence test measures: A theoretical account of the processing in the Raven Progressive Matrices Test. Psychological Review, 97(3), 404–431.",
  "Carroll, J. B. (1993). Human cognitive abilities: A survey of factor-analytic studies. Cambridge University Press.",
  "Chalmers, R. P. (2012). mirt: A multidimensional item response theory package for the R environment. Journal of Statistical Software, 48(6), 1–29.",
  "Condon, D. M., & Revelle, W. (2014). The International Cognitive Ability Resource: Development and initial validation of a public-domain measure. Intelligence, 43, 52–64.",
  "De Ayala, R. J. (2009). The theory and practice of item response theory. Guilford.",
  "Ekstrom, R. B., French, J. W., Harman, H. H., & Dermen, D. (1976). Manual for kit of factor-referenced cognitive tests. Educational Testing Service.",
  "Embretson, S. E. (1998). A cognitive design system approach to generating valid tests: Application to abstract reasoning. Psychological Methods, 3(3), 380–396.",
  "Embretson, S. E., & Reise, S. P. (2000). Item response theory for psychologists. Erlbaum.",
  "Fischer, G. H. (1973). The linear logistic test model as an instrument in educational research. Acta Psychologica, 37(6), 359–374.",
  "Holland, P. W., & Thayer, D. T. (1988). Differential item performance and the Mantel–Haenszel procedure. In H. Wainer & H. I. Braun (Eds.), Test validity (pp. 129–145). Erlbaum.",
  "Hu, S., Ma, Y., Liu, X., Wei, Y., & Bai, S. (2021). Stratified rule-aware network for abstract visual reasoning. Proceedings of the AAAI Conference on Artificial Intelligence, 35(2), 1567–1574.",
  "Kingsbury, G. G., & Zara, A. R. (1989). Procedures for selecting items for computerized adaptive tests. Applied Measurement in Education, 2(4), 359–375.",
  "Kolen, M. J., & Brennan, R. L. (2014). Test equating, scaling, and linking (3rd ed.). Springer.",
  "Lenhard, A., Lenhard, W., Suggate, S., & Segerer, R. (2018). A continuous solution to the norming problem. Assessment, 25(1), 112–125.",
  "Lord, F. M. (1980). Applications of item response theory to practical testing problems. Erlbaum.",
  "Matzen, L. E., Benz, Z. O., Dixon, K. R., Posey, J., Kroger, J. K., & Speed, A. E. (2010). Recreating Raven's: Software for systematically generating large numbers of Raven-like matrix problems with normed properties. Behavior Research Methods, 42(2), 525–541.",
  "Neisser, U., Boodoo, G., Bouchard, T. J., Jr., et al. (1996). Intelligence: Knowns and unknowns. American Psychologist, 51(2), 77–101.",
  "Primi, R. (2001). Complexity of geometric inductive reasoning tasks: Contribution to the understanding of fluid intelligence. Intelligence, 30(1), 41–70.",
  "Schneider, W. J., & McGrew, K. S. (2018). The Cattell–Horn–Carroll theory of cognitive abilities. In D. P. Flanagan & E. M. McDonough (Eds.), Contemporary intellectual assessment (4th ed., pp. 73–163). Guilford.",
  "Shepard, R. N., & Metzler, J. (1971). Mental rotation of three-dimensional objects. Science, 171(3972), 701–703.",
  "van der Linden, W. J., & Glas, C. A. W. (Eds.). (2010). Elements of adaptive testing. Springer.",
  "Weiss, D. J. (1982). Improving measurement quality and efficiency with adaptive testing. Applied Psychological Measurement, 6(4), 473–492.",
  "Wise, S. L., & Kong, X. (2005). Response time effort: A new measure of examinee motivation in computer-based tests. Applied Measurement in Education, 18(2), 163–183.",
];

export default function MethodologyPage() {
  const scored = bank.items.filter((i) => !i.practice);
  const count = (d: Domain) => scored.filter((i) => i.domain === d).length;
  const adaptive = scored.filter((i) => ["Gf", "Gv", "Gq", "Gc"].includes(i.domain)).length;
  const sim = summary.results.filter((r) => r.condition === "provisional");

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="eyebrow">Methodology</p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">How this assessment works</h1>
      <p className="mt-4 text-lg leading-8 text-muted-foreground">
        A summary of the scientific design, the scoring, and the limits of what the results can mean. The full technical
        documentation, including the validation roadmap, lives in the project&apos;s <code className="text-base">docs/</code>{" "}
        folder.
      </p>

      <nav aria-label="On this page" className="mt-8 rounded-xl border bg-card p-5 text-sm">
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {[
            ["status", "Status: a research preview"],
            ["framework", "Theoretical framework"],
            ["items", "The item bank"],
            ["adaptive", "Adaptive testing"],
            ["scoring", "Scoring"],
            ["precision", "Precision (simulated)"],
            ["limitations", "Limitations"],
            ["what-iq-measures", "What IQ tests measure"],
            ["roadmap", "Path to validation"],
            ["references", "References"],
          ].map(([id, label], i) => (
            <li key={id}>
              <a href={`#${id}`} className="text-muted-foreground hover:text-foreground">
                {i + 1}. {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="prose-quiet mt-4">
        <h2 id="status">1. Status: a research preview</h2>
        <p>
          Everything a participant sees is real and complete: original items, an adaptive engine, and a scoring model with
          stated uncertainty. What does <strong>not</strong> exist yet is empirical evidence. No item has been calibrated on
          real participants, there is no norm sample, and no reliability or validity study has been run. Consequently the
          assessment reports <em>provisional</em> results only. It never produces an IQ, a percentile, or any comparison
          with other people, and its results are not a diagnosis.
        </p>

        <h2 id="framework">2. Theoretical framework</h2>
        <p>
          The structure follows the Cattell–Horn–Carroll (CHC) model (Carroll, 1993; Schneider &amp; McGrew, 2018), in
          which a general factor sits above broad abilities, each sampled here by tasks targeting specific narrow
          abilities. The design takes its general approach from established batteries (comprehensive coverage, separate
          index scores, a composite only with justification) and from Raven-type matrices, but contains no material from
          any published test.
        </p>
        <div className="not-prose my-6 overflow-x-auto rounded-xl border bg-card" tabIndex={0} role="region" aria-label="Abilities and item families (scrollable)">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Broad ability</th>
                <th className="px-4 py-2.5 font-medium">Narrow abilities</th>
                <th className="px-4 py-2.5 font-medium">Item families</th>
                <th className="px-4 py-2.5 text-right font-medium">Items</th>
              </tr>
            </thead>
            <tbody>
              {FAMILY_NOTES.map((f) => (
                <tr key={f.domain} className="border-t align-top">
                  <td className="px-4 py-2.5 font-medium">{DOMAIN_LABELS[f.domain]}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{f.narrow}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{f.families}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{count(f.domain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The quick mode ({QUICK_BLUEPRINT.estimatedMinutes.join("–")} min) measures fluid reasoning only. The full mode (
          {FULL_BLUEPRINT.estimatedMinutes.join("–")} min) has {FULL_BLUEPRINT.sections.length} sections covering all six
          abilities.
        </p>

        <h2 id="items">3. The item bank</h2>
        <p>
          Version {bank.bankVersion} contains {bank.items.length} items: {adaptive} adaptively administered reasoning and
          knowledge items, {count("Gwm")} working-memory trials, {count("Gs")} speed trials and{" "}
          {bank.items.length - scored.length} practice items. All are original.
        </p>
        <h3>Structured generation</h3>
        <p>
          Figural, spatial, quantitative and deductive items are produced by rule-based generators rather than written one
          by one. A matrix item, for example, is specified as a set of attributes (shape, number, size, fill, direction,
          line elements, marker position), each governed by a rule from the taxonomy of Carpenter, Just and Shell (1990):
          constant in a row, progression, distribution of three values, figure addition or subtraction, and Boolean
          superimposition. The answer options come from an attribute-bisection tree (Hu et al., 2021): three attributes
          each take either the correct value or one plausible wrong value, so every attribute value occurs in exactly half
          of the eight options and the answer cannot be found by choosing the most &ldquo;typical&rdquo; option.
        </p>
        <h3>Independent verification</h3>
        <p>
          The generators&apos; own keys are not trusted. Each family has an independent checker: a matrix solver that infers
          rules row- and column-wise from a deliberately larger rule library and rejects any item where two readings give
          different answers; exhaustive model enumeration for every deduction item; canonical-form geometry for rotation
          items; exact reflection geometry for paper folding; a library of simple sequence rules for number series (an item
          is rejected if any simple rule predicts a different next number); exact rational arithmetic for balance problems;
          and brute-force search for number matrices. Automated tests also check that no context-blind shortcut (picking the
          most typical, the odd-one-out or the most symmetric option) beats chance. The bank is frozen with a content hash per
          item, so any change to an item is visible and versioned.
        </p>
        <p>
          Verbal items cannot be machine-proven. They were written by hand and are checked only for structure; semantic
          soundness needs expert review and pilot statistics.
        </p>
        <p>
          <strong>Logically correct is not psychometrically valid.</strong> Verification establishes that every item has one
          defensible answer. Whether an item measures what it is meant to, and how difficult it really is, can only be learned
          from real responses.
        </p>
        <h3>A priori difficulty</h3>
        <p>
          Each item has a provisional difficulty from a documented complexity model in the spirit of the cognitive design
          system approach (Embretson, 1998) and the linear logistic test model (Fischer, 1973): more rules, harder rule types,
          more folds, larger rotations and rarer words mean higher difficulty (Carpenter et al., 1990; Primi, 2001; Shepard &amp;
          Metzler, 1971). The weights are expert judgement, not estimates.
        </p>

        <h2 id="adaptive">4. Adaptive testing</h2>
        <p>
          The reasoning and knowledge sections are computerised adaptive tests. Each starts at medium difficulty (the
          estimate begins at the centre of the scale), updates an ability estimate after every answer, and chooses the next
          item to be maximally informative at the current estimate (Lord, 1980; Weiss, 1982). Correct answers therefore
          lead to harder items and errors to easier ones. Two refinements keep the test balanced and less predictable:
          content balancing across item families and &ldquo;randomesque&rdquo; selection among the three most informative
          items (Kingsbury &amp; Zara, 1989). A section stops at a target precision, a maximum number of items or a time
          budget.
        </p>
        <p>
          <strong>Provisional item parameters.</strong> Without calibration data the engine uses an explicitly provisional
          model: difficulty b = the a priori logit, discrimination a = 1, and a guessing floor c = 1/k for k answer options.
          This model is good enough to steer item selection; it is not a calibrated IRT model. The code keeps it strictly
          separate from empirically calibrated parameters, which can be loaded later per item and version (2PL or 3PL).
        </p>
        <p>
          <strong>Estimation.</strong> Ability is estimated by expected a posteriori (EAP) estimation with a standard normal
          prior (Bock &amp; Mislevy, 1982), which is defined for every response pattern and yields a posterior standard
          deviation as its standard error.
        </p>
        <p>
          <strong>Working memory</strong> uses the conventional ascending procedure: two sequences per length, ending when
          both sequences of a length are missed. Sequences are shown visually, one element per second.{" "}
          <strong>Processing speed</strong> is scored as correct minus incorrect answers per minute in two 60-second blocks.
          Because browser and device latency differ (Bridges et al., 2020; Anwyl-Irvine et al., 2021), timing uses the
          monotonic clock and paint-synchronised stimulus onset, a simple-reaction baseline is measured on the same device,
          time while the page is hidden is excluded, and an interrupted speed block restarts.
        </p>

        <h2 id="scoring">5. Scoring</h2>
        <h3>What is reported today</h3>
        <ul>
          <li>For each adaptive domain: a provisional ability estimate on the test&apos;s own logit scale with its 95% interval,
            translated into the five difficulty levels of the item bank.</li>
          <li>Raw measures: items answered, longest span recalled, items per minute, response times.</li>
          <li>A within-person profile, which calls a domain a relative strength or weakness only if it differs from the
            person&apos;s own average by more than measurement error allows.</li>
          <li>Response-validity indicators: rapid guessing (Wise &amp; Kong, 2005), time-outs, interruptions.</li>
        </ul>
        <p>
          Raw accuracy is reported but explicitly not used as a measure of ability, because in an adaptive test everyone
          answers a similar share correctly.
        </p>
        <h3>What would be reported with validated norms</h3>
        <p>
          An IQ is norm-referenced: it expresses a standardised ability estimate on a scale with mean 100 and standard
          deviation 15 in a reference population, IQ = 100 + 15 × z, where z = (θ − μ<sub>age</sub>) / σ<sub>age</sub>. The
          scoring code implements this, together with confidence intervals, age-adjusted percentiles and a full-scale
          composite, but it is locked: it runs only when a validated norm table, an empirical calibration of the same items,
          a stated age within the normed range, standard administration and acceptable response validity are all present.
          None of those exist today, so the results page shows why the scores are unavailable instead of inventing them.
          A general-ability composite will be offered only if a norming study supports one with structural-validity
          evidence.
        </p>

        <h2 id="precision">6. Precision (simulated)</h2>
        <p>
          A Monte Carlo study runs simulated test-takers of known ability through the real engine. It is{" "}
          <strong>not validation</strong>: it only shows how the scoring behaves if the assumed response model were true, and
          how it degrades when the model is wrong.
        </p>
        <div className="not-prose my-6 overflow-x-auto rounded-xl border bg-card" tabIndex={0} role="region" aria-label="Simulated precision (scrollable)">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="px-4 pt-3 text-left text-xs text-muted-foreground">
              Simulated, assumed model, ability distributed N(0, 1). Generated {summary.generated}.
            </caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Section</th>
                <th className="px-4 py-2.5 text-right font-medium">Items (mean)</th>
                <th className="px-4 py-2.5 text-right font-medium">Standard error</th>
                <th className="px-4 py-2.5 text-right font-medium">Marginal reliability</th>
              </tr>
            </thead>
            <tbody>
              {sim.map((r) => (
                <tr key={`${r.mode}-${r.domain}`} className="border-t">
                  <td className="px-4 py-2.5">
                    {r.mode === "quick" ? "Quick" : "Full"} · {DOMAIN_LABELS[r.domain as Domain]}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.meanItems}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.meanSE.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.marginalReliability.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Short sections give modest precision. More importantly, the simulation shows systematic <strong>floor and ceiling
          effects</strong>: estimates for people far from the middle of the scale are pulled toward it, and their intervals
          are too narrow. The chart below shows the bias in quick mode.
        </p>
        <SimulationBiasChart />

        <h2 id="limitations">7. Limitations</h2>
        <ul>
          <li>No empirical calibration, no norms, no reliability or validity evidence from real participants.</li>
          <li>A priori difficulties are expert judgements; the provisional model ignores differences in discrimination.</li>
          <li>Comparisons between domains assume their provisional scales are equivalent, which is unverified.</li>
          <li>Short sections; estimates at the extremes are biased toward the middle (see above).</li>
          <li>Verbal items are English-only and culturally loaded; non-native speakers are disadvantaged.</li>
          <li>Visual items require normal or corrected vision; there is no non-visual alternative.</li>
          <li>Unproctored online testing: help, distraction and repeated attempts cannot be controlled. Retaking the test
            with the same bank inflates scores (practice effects).</li>
          <li>Working-memory sequences are visual, not auditory; processing-speed scores depend on device and input method.</li>
          <li>Answer keys are delivered to the browser; for high-stakes use, scoring would have to move to a server.</li>
        </ul>

        <h2 id="what-iq-measures">8. What IQ tests measure — and what they don&apos;t</h2>
      </article>
      <div className="mt-4">
        <WhatIqMeasures defaultOpen />
      </div>

      <article className="prose-quiet">
        <h2 id="roadmap">9. Path to validation</h2>
        <ol>
          <li><strong>Expert review</strong> of every item, especially the verbal ones, and an accessibility review.</li>
          <li><strong>Pilot study</strong> (fixed forms, a few hundred participants): classical item analysis, timing, and an
            LLTM check of the complexity model.</li>
          <li><strong>Calibration study</strong>: a linked multi-form design large enough for 2PL/3PL estimation (commonly
            several hundred to over a thousand responses per item; De Ayala, 2009), fitted in validated software such as R{" "}
            <code>mirt</code> (Chalmers, 2012), with checks of dimensionality, item fit and local dependence.</li>
          <li><strong>Fairness</strong>: differential item functioning analyses by sex, age, language background and device
            (Holland &amp; Thayer, 1988).</li>
          <li><strong>Norming</strong>: a representative, age-stratified sample under standardised conditions, with
            continuous norming across age (Lenhard et al., 2018) and documented sampling.</li>
          <li><strong>Reliability and validity</strong>: test–retest stability, convergent validity with established
            instruments under appropriate ethics approval, structural validity of the CHC model and any composite, and
            documentation following the Standards for Educational and Psychological Testing (AERA, APA, &amp; NCME, 2014).</li>
        </ol>
        <p>
          The application already exports anonymous response data in the long format calibration software expects, from
          participants who consent, and includes Mantel–Haenszel DIF, reliability and item-analysis utilities. See{" "}
          <code>docs/VALIDATION_ROADMAP.md</code>.
        </p>

        <h2 id="references">10. References</h2>
        <ul className="!list-none !pl-0 text-sm text-muted-foreground">
          {REFERENCES.map((r) => (
            <li key={r} className="pl-6 -indent-6">
              {r}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          <Link href="/">Back to the start</Link>
        </p>
      </article>
    </div>
  );
}
