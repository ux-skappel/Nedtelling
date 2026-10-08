/**
 * Within-person (ipsative) profile analysis.
 *
 * A domain is called a relative strength or weakness only if it differs from
 * the person's own mean across domains by more than the measurement error
 * allows (two-sided 95%). With the short provisional sections in this test
 * most differences will NOT reach that bar — which is the honest outcome.
 *
 * Important assumption: comparing provisional estimates across domains
 * presumes that the a priori difficulty scales of different domains are
 * comparable. That has not been verified, so even "reliable" differences are
 * flagged as tentative in the interface.
 */

import type { Domain } from "../items/types";

export interface ProfileInput {
  domain: Domain;
  theta: number;
  se: number;
}

export interface ProfileEntry {
  domain: Domain;
  deviation: number;
  seDeviation: number;
  /** Deviation divided by its standard error (a within-person statistic, not a population z-score). */
  criticalRatio: number;
  classification: "relative-strength" | "relative-weakness" | "no-reliable-difference";
}

export function relativeProfile(inputs: ProfileInput[], zCrit = 1.959963984540054): ProfileEntry[] {
  const k = inputs.length;
  if (k < 2) return [];
  const mean = inputs.reduce((s, d) => s + d.theta, 0) / k;
  const sumVar = inputs.reduce((s, d) => s + d.se * d.se, 0);
  return inputs.map((d) => {
    // Var(θ_d − mean) = Var(θ_d)(1 − 2/k) + Σ Var(θ_j)/k², assuming independent errors.
    const v = d.se * d.se * (1 - 2 / k) + sumVar / (k * k);
    const seDeviation = Math.sqrt(v);
    const deviation = d.theta - mean;
    const criticalRatio = deviation / seDeviation;
    return {
      domain: d.domain,
      deviation,
      seDeviation,
      criticalRatio,
      classification: criticalRatio > zCrit ? "relative-strength" : criticalRatio < -zCrit ? "relative-weakness" : "no-reliable-difference",
    };
  });
}
