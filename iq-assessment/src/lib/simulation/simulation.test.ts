/**
 * Simulation checks of the adaptive engine (small replication counts; the
 * full study is `npm run simulate`). SIMULATED, NOT VALIDATED: these tests
 * check internal consistency with the assumed model, nothing more.
 */

import { describe, expect, it } from "vitest";
import { runStudy } from "./study";

describe("simulation: quick-mode fluid reasoning under the assumed model", () => {
  const r = runStudy({ mode: "quick", domain: "Gf", condition: "provisional", grid: [-3, -1, 0, 1, 3], repsPerTheta: 60, populationN: 150, seed: 7 });
  const at = (t: number) => r.grid.find((g) => g.theta === t)!;

  it("recovers abilities in the middle of the scale with small bias", () => {
    for (const t of [-1, 0, 1]) expect(Math.abs(at(t).bias), `θ=${t}`).toBeLessThan(0.35);
  });

  it("reports standard errors that match the actual spread of estimates", () => {
    for (const t of [-1, 0, 1]) expect(at(t).meanSE / at(t).empiricalSD, `θ=${t}`).toBeGreaterThan(0.75);
  });

  it("covers the true value close to the nominal rate in the middle of the scale", () => {
    for (const t of [-1, 0, 1]) expect(at(t).coverage95, `θ=${t}`).toBeGreaterThan(0.85);
  });

  it("shows the documented floor/ceiling shrinkage: extremes are pulled toward the middle", () => {
    expect(at(-3).bias).toBeGreaterThan(0.3);
    expect(at(3).bias).toBeLessThan(-0.3);
    // ...but the ordering of people is preserved
    expect(at(-3).meanEstimate).toBeLessThan(at(-1).meanEstimate);
    expect(at(3).meanEstimate).toBeGreaterThan(at(1).meanEstimate);
  });

  it("achieves a marginal reliability consistent with a ~20-item adaptive test", () => {
    expect(r.population.marginalReliability).toBeGreaterThan(0.65);
    expect(r.population.marginalReliability).toBeLessThan(0.9);
  });
});

describe("simulation: robustness to model error", () => {
  it("still orders simulees correctly when item parameters are wrong", () => {
    const r = runStudy({ mode: "quick", domain: "Gf", condition: "misspecified", grid: [-2, 0, 2], repsPerTheta: 40, populationN: 100, seed: 9 });
    const est = r.grid.map((g) => g.meanEstimate);
    expect(est[0]).toBeLessThan(est[1]);
    expect(est[1]).toBeLessThan(est[2]);
    expect(r.population.trueScoreR2).toBeGreaterThan(0.5);
  });
});
