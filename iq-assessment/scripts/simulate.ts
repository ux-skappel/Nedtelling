/**
 * Simulation study of the adaptive engine.
 *
 *   npm run simulate            # full study (a few minutes)
 *   npm run simulate -- --fast  # smaller replication counts
 *
 * Writes docs/SIMULATION_REPORT.md and src/data/simulation-summary.json.
 *
 * SIMULATION IS NOT VALIDATION: see the report's preamble.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Mode } from "../src/lib/assessment/blueprint";
import { DOMAIN_LABELS, type Domain } from "../src/lib/items/types";
import { CONDITIONS, runStudy, type StudyResult } from "../src/lib/simulation/study";

const fast = process.argv.includes("--fast");
const GRID = [-3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
const PLAN: { mode: Mode; domain: Domain; reps: number; pop: number }[] = [
  { mode: "quick", domain: "Gf", reps: fast ? 40 : 200, pop: fast ? 200 : 1000 },
  { mode: "full", domain: "Gf", reps: fast ? 30 : 150, pop: fast ? 150 : 600 },
  { mode: "full", domain: "Gv", reps: fast ? 30 : 150, pop: fast ? 150 : 600 },
  { mode: "full", domain: "Gq", reps: fast ? 30 : 150, pop: fast ? 150 : 600 },
  { mode: "full", domain: "Gwm", reps: fast ? 30 : 150, pop: fast ? 150 : 600 },
  { mode: "full", domain: "Gc", reps: fast ? 30 : 150, pop: fast ? 150 : 600 },
];

const f2 = (x: number) => (x >= 0 ? " " : "") + x.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const t0 = Date.now();
const results: StudyResult[] = [];
let seed = 1000;
for (const p of PLAN) {
  for (const condition of Object.keys(CONDITIONS)) {
    const t = Date.now();
    results.push(runStudy({ mode: p.mode, domain: p.domain, condition, grid: GRID, repsPerTheta: p.reps, populationN: p.pop, seed: seed++ }));
    console.log(`${p.mode} ${p.domain} ${condition}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
}

function table(r: StudyResult): string {
  const head = "| true θ | mean θ̂ | bias | RMSE | mean SE | SD(θ̂) | 95% coverage | items | % correct |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const rows = r.grid.map(
    (g) =>
      `| ${f2(g.theta)} | ${f2(g.meanEstimate)} | ${f2(g.bias)} | ${g.rmse.toFixed(2)} | ${g.meanSE.toFixed(2)} | ${g.empiricalSD.toFixed(2)} | ${pct(g.coverage95)} | ${g.meanItems.toFixed(1)} | ${pct(g.meanAccuracy)} |`,
  );
  return [head, ...rows].join("\n");
}

function findings(r: StudyResult): string[] {
  const at = (t: number) => r.grid.find((g) => g.theta === t)!;
  const mid = r.grid.filter((g) => Math.abs(g.theta) <= 1.5);
  const out: string[] = [];
  out.push(
    `Within |θ| ≤ 1.5 the largest absolute bias is ${Math.max(...mid.map((g) => Math.abs(g.bias))).toFixed(2)} logits and RMSE ranges ${Math.min(...mid.map((g) => g.rmse)).toFixed(2)}–${Math.max(...mid.map((g) => g.rmse)).toFixed(2)}.`,
  );
  out.push(
    `Floor/ceiling: at θ = −3 the mean estimate is ${f2(at(-3).meanEstimate)} (bias ${f2(at(-3).bias)}); at θ = +3 it is ${f2(at(3).meanEstimate)} (bias ${f2(at(3).bias)}). ` +
      `Low performers are systematically over-estimated and high performers under-estimated beyond about |θ| = 2.`,
  );
  out.push(
    `Interval coverage in |θ| ≤ 1.5: ${pct(Math.min(...mid.map((g) => g.coverage95)))}–${pct(Math.max(...mid.map((g) => g.coverage95)))} (nominal 95%).`,
  );
  out.push(
    `In a population with θ ~ N(0, 1): marginal reliability ${r.population.marginalReliability.toFixed(2)}, squared correlation with the true θ ${r.population.trueScoreR2.toFixed(2)}, ${r.population.meanItems.toFixed(1)} items on average.`,
  );
  return out;
}

function mainFindings(): string {
  const A = results.filter((r) => r.condition === "provisional");
  const B = results.filter((r) => r.condition === "misspecified");
  const at = (r: StudyResult, t: number) => r.grid.find((g) => g.theta === t)!;
  const mid = (r: StudyResult) => r.grid.filter((g) => Math.abs(g.theta) <= 1.5);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const range = (xs: number[], f = (x: number) => x.toFixed(2)) => `${f(Math.min(...xs))} to ${f(Math.max(...xs))}`;
  const label = (r: StudyResult) => `${r.mode} ${r.domain}`;
  const lowBias = A.map((r) => at(r, -3).bias);
  const highBias = A.map((r) => at(r, 3).bias);
  const extremeCov = results.flatMap((r) => [at(r, -3).coverage95, at(r, 3).coverage95]);
  const midCovA = A.map((r) => avg(mid(r).map((g) => g.coverage95)));
  const pairs = A.map((a) => ({ a, b: B.find((b) => b.mode === a.mode && b.domain === a.domain)! }));
  const dRmse = pairs.map(({ a, b }) => avg(mid(b).map((g) => g.rmse)) - avg(mid(a).map((g) => g.rmse)));
  const midCovB = B.map((r) => avg(mid(r).map((g) => g.coverage95)));
  const worstExtreme = pairs
    .map(({ a, b }) => ({ name: label(a), a: at(a, 3).coverage95, b: at(b, 3).coverage95 }))
    .sort((x, y) => x.b - y.b)[0];
  const acc = A.find((r) => r.mode === "quick")!;
  const accRange = range(acc.grid.filter((g) => Math.abs(g.theta) <= 2).map((g) => g.meanAccuracy), (x) => `${Math.round(x * 100)}%`);
  const rel = A.map((r) => `${label(r)} ${r.population.marginalReliability.toFixed(2)}`).join(", ");
  return [
    `1. **Shrinkage at the extremes (floor and ceiling effects).** EAP estimation pulls estimates toward the prior mean, and the bank thins out at the ends of the scale. In condition A the bias at θ = −3 is ${range(lowBias)} logits (over-estimation of low performers) and at θ = +3 it is ${range(highBias)} (under-estimation of high performers). The reported 95% intervals are too narrow there: across all domains and both conditions, coverage at θ = ±3 is only ${range(extremeCov, (x) => `${Math.round(x * 100)}%`)}. Results at the ends of the scale are therefore shown only as broad levels, and the interface never extrapolates beyond the bank.`,
    `2. **Short sections are imprecise, but honest about it in the middle of the scale.** Marginal reliability in a N(0, 1) population (condition A): ${rel}. For |θ| ≤ 1.5 the reported intervals cover the true value ${range(midCovA, (x) => `${Math.round(x * 100)}%`)} of the time (nominal 95%). With standard errors of this size, small differences between domains are not interpretable, which is why the profile analysis rarely flags strengths or weaknesses.`,
    `3. **The simulated model error mainly hurts at the extremes.** With the misspecified generating model (condition B), mid-scale RMSE changes by ${range(dRmse, (x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`)} logits and mid-scale coverage stays at ${range(midCovB, (x) => `${Math.round(x * 100)}%`)}. At θ = +3, coverage drops further, worst for ${worstExtreme.name} (${Math.round(worstExtreme.a * 100)}% → ${Math.round(worstExtreme.b * 100)}%). The simulated error is deliberately moderate; real parameters may deviate more, and no simulation can show whether the provisional scale means the same thing across domains. This is why the scores remain provisional until an empirical calibration.`,
    `4. **Percentage correct is uninformative in an adaptive test.** In quick mode, simulees between θ = −2 and +2 answer ${accRange} of items correctly on average — far less spread than ability itself, because the questions adapt to each person (the remaining spread comes from guessing and from where the bank runs out). The results page explains this and does not use accuracy as an ability measure.`,
    `5. **Working memory pools four span tasks** (~36 trials), which gives it the highest model-based reliability. That figure is optimistic: trials within a task are not independent and the four tasks differ in what they demand, neither of which the provisional model represents.`,
    `6. **Processing speed is not simulated:** it is scored as a rate, not with the IRT model.`,
  ].join("\n");
}

const generated = new Date().toISOString().slice(0, 10);
const sections = PLAN.map((p) => {
  const prov = results.find((r) => r.mode === p.mode && r.domain === p.domain && r.condition === "provisional")!;
  const mis = results.find((r) => r.mode === p.mode && r.domain === p.domain && r.condition === "misspecified")!;
  return `### ${p.mode === "quick" ? "Quick mode" : "Full mode"} — ${DOMAIN_LABELS[p.domain]} (${p.domain})

${p.reps} simulees per θ value; population summary from ${p.pop} simulees with θ ~ N(0, 1).

**Condition A — responses follow the provisional model the engine assumes**

${findings(prov).map((x) => `- ${x}`).join("\n")}

${table(prov)}

**Condition B — responses follow a different ("true") model**

${findings(mis).map((x) => `- ${x}`).join("\n")}

${table(mis)}
`;
}).join("\n");

const popTable = [
  "| Mode | Domain | Condition | Marginal reliability | r²(θ, θ̂) | Mean items | Mean SE |",
  "|---|---|---|---:|---:|---:|---:|",
  ...results.map(
    (r) =>
      `| ${r.mode} | ${r.domain} | ${r.condition} | ${r.population.marginalReliability.toFixed(2)} | ${r.population.trueScoreR2.toFixed(2)} | ${r.population.meanItems.toFixed(1)} | ${r.population.meanSE.toFixed(2)} |`,
  ),
].join("\n");

const md = `# Simulation report

> **Simulation is not validation.** Every number below comes from simulated
> test-takers who answer according to an item response model chosen by us.
> It shows how the scoring machinery behaves *if* that model were true
> (condition A) and how robust it is when the model is wrong in plausible
> ways (condition B). It says nothing about whether the items measure
> intelligence in real people, and none of these figures may be quoted as
> the reliability or validity of the test.

Generated by \`npm run simulate${fast ? " -- --fast" : ""}\` on ${generated}. Item bank 1.0.0.

## Method

Each simulee is a person with a known true ability θ on the test's
provisional logit scale. The simulee takes the real assessment through the
real engine — the same item selection (maximum information with content
balancing and randomesque exposure control), EAP estimation with a N(0, 1)
prior, and stopping rules as the browser — answering each item correctly
with the probability the generating model assigns.

* **Condition A ("provisional")**: the generating model *is* the provisional
  model (a = 1, b = a priori logit, c = 1/k).
* **Condition B ("misspecified")**: each item has its own "true" parameters:
  discrimination a ~ logNormal(0, 0.3), difficulty b = a priori logit + N(0, 0.5),
  and a guessing floor between 0.6 and 1.1 times 1/k. This mimics the
  situation after a real calibration study, which will certainly find that
  the a priori parameters are off.

Ability is simulated on a grid from −3.5 to +3.5. Columns: mean estimate,
bias (mean estimate − true θ), root-mean-square error, the standard error the
engine reports, the actual spread of estimates, how often the reported 95%
interval contains the true θ, the number of items administered, and the
share answered correctly.

## Summary

${popTable}

## Main findings

${mainFindings()}

## Detailed results

${sections}
`;

writeFileSync(resolve(__dirname, "../docs/SIMULATION_REPORT.md"), md);

const summary = {
  generated,
  note: "Simulation under assumed models — not validation evidence.",
  results: results.map((r) => ({
    mode: r.mode,
    domain: r.domain,
    condition: r.condition,
    marginalReliability: Number(r.population.marginalReliability.toFixed(3)),
    trueScoreR2: Number(r.population.trueScoreR2.toFixed(3)),
    meanItems: Number(r.population.meanItems.toFixed(1)),
    meanSE: Number(r.population.meanSE.toFixed(3)),
    grid: r.grid.map((g) => ({
      theta: g.theta,
      bias: Number(g.bias.toFixed(3)),
      rmse: Number(g.rmse.toFixed(3)),
      meanSE: Number(g.meanSE.toFixed(3)),
      coverage95: Number(g.coverage95.toFixed(3)),
    })),
  })),
};
writeFileSync(resolve(__dirname, "../src/data/simulation-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
