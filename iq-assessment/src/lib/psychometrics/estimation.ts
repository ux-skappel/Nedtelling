/**
 * Ability estimation.
 *
 * The primary estimator is EAP (expected a posteriori; Bock & Mislevy, 1982)
 * computed by fixed-point quadrature. EAP is the conventional choice for
 * adaptive tests because it is defined for every response pattern (including
 * all-correct and all-wrong, where the maximum-likelihood estimate diverges)
 * and because its posterior standard deviation (PSD) is a direct statement
 * of uncertainty.
 *
 * EAP shrinks toward the prior mean. For short tests that is a real,
 * systematic effect at the extremes (high scorers are pulled down, low
 * scorers up). The simulation study documents its size; the results page
 * reports it as a limitation rather than hiding it.
 *
 * MLE (Newton–Raphson / Fisher scoring) is provided for comparison and for
 * use by the validated pipeline if a future norming study prefers it.
 */

import { information, logLikelihood, probability, type ScoredResponse } from "./irt";

export interface NormalPrior {
  mean: number;
  sd: number;
}

export const STANDARD_PRIOR: NormalPrior = { mean: 0, sd: 1 };

export interface QuadratureSpec {
  min: number;
  max: number;
  points: number;
}

export const DEFAULT_QUADRATURE: QuadratureSpec = { min: -6, max: 6, points: 121 };

export interface Estimate {
  theta: number;
  /** Posterior SD for EAP; asymptotic SE (1/√I) for MLE. */
  se: number;
}

function grid(spec: QuadratureSpec): number[] {
  const step = (spec.max - spec.min) / (spec.points - 1);
  return Array.from({ length: spec.points }, (_, i) => spec.min + i * step);
}

const gridCache = new Map<string, number[]>();
function cachedGrid(spec: QuadratureSpec): number[] {
  const key = `${spec.min}:${spec.max}:${spec.points}`;
  let g = gridCache.get(key);
  if (!g) {
    g = grid(spec);
    gridCache.set(key, g);
  }
  return g;
}

/** Posterior weights over the quadrature grid (normalised to sum to 1). */
export function posterior(
  responses: readonly ScoredResponse[],
  prior: NormalPrior = STANDARD_PRIOR,
  spec: QuadratureSpec = DEFAULT_QUADRATURE,
): { nodes: number[]; weights: number[] } {
  const nodes = cachedGrid(spec);
  const logw = nodes.map((t) => {
    const z = (t - prior.mean) / prior.sd;
    return -0.5 * z * z + logLikelihood(t, responses);
  });
  const maxLog = Math.max(...logw);
  const w = logw.map((l) => Math.exp(l - maxLog));
  const total = w.reduce((s, x) => s + x, 0);
  return { nodes, weights: w.map((x) => x / total) };
}

export function eap(
  responses: readonly ScoredResponse[],
  prior: NormalPrior = STANDARD_PRIOR,
  spec: QuadratureSpec = DEFAULT_QUADRATURE,
): Estimate {
  const { nodes, weights } = posterior(responses, prior, spec);
  let m = 0;
  for (let i = 0; i < nodes.length; i++) m += nodes[i] * weights[i];
  let v = 0;
  for (let i = 0; i < nodes.length; i++) v += (nodes[i] - m) * (nodes[i] - m) * weights[i];
  return { theta: m, se: Math.sqrt(v) };
}

export type MleOutcome =
  | { kind: "estimate"; theta: number; se: number; iterations: number }
  | { kind: "undefined"; reason: "no-responses" | "all-correct" | "all-incorrect" | "no-convergence" };

/**
 * Maximum-likelihood θ by Fisher scoring, bounded to [-bound, bound].
 * Returns `undefined` for response patterns without a finite maximum.
 */
export function mle(
  responses: readonly ScoredResponse[],
  { bound = 6, maxIter = 100, tol = 1e-6 } = {},
): MleOutcome {
  if (responses.length === 0) return { kind: "undefined", reason: "no-responses" };
  if (responses.every((r) => r.correct)) return { kind: "undefined", reason: "all-correct" };
  if (responses.every((r) => !r.correct)) return { kind: "undefined", reason: "all-incorrect" };

  // Start from a coarse grid search so Fisher scoring begins near the mode;
  // 3PL likelihoods can be multimodal and a bad start may lock onto a local
  // maximum at low θ.
  let theta = 0;
  let best = -Infinity;
  for (let t = -bound; t <= bound; t += 0.25) {
    const ll = logLikelihood(t, responses);
    if (ll > best) {
      best = ll;
      theta = t;
    }
  }

  for (let iter = 1; iter <= maxIter; iter++) {
    let score = 0;
    let info = 0;
    for (const r of responses) {
      const { a, c } = r.params;
      const p = probability(theta, r.params);
      // d log L / dθ for the 3PL: a · (P − c) / (P(1 − c)) · (u − P)
      const w = (p - c) / (p * (1 - c));
      score += a * w * ((r.correct ? 1 : 0) - p);
      info += information(theta, r.params);
    }
    if (info <= 0) return { kind: "undefined", reason: "no-convergence" };
    const step = score / info;
    const next = Math.max(-bound, Math.min(bound, theta + step));
    if (Math.abs(next - theta) < tol) {
      const finalInfo = responses.reduce((s, r) => s + information(next, r.params), 0);
      return { kind: "estimate", theta: next, se: 1 / Math.sqrt(finalInfo), iterations: iter };
    }
    theta = next;
  }
  return { kind: "undefined", reason: "no-convergence" };
}

/** Two-sided normal-theory interval around an estimate. */
export function confidenceInterval(est: Estimate, level = 0.95): [number, number] {
  // z for common levels; avoids importing the quantile function for the
  // overwhelmingly common 95% case.
  const z = level === 0.95 ? 1.959963984540054 : level === 0.9 ? 1.6448536269514722 : level === 0.68 ? 0.994457883209753 : NaN;
  if (Number.isNaN(z)) throw new Error(`Unsupported confidence level ${level}`);
  return [est.theta - z * est.se, est.theta + z * est.se];
}
