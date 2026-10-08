/**
 * Item response theory: response functions and information.
 *
 * All models are expressed through the three-parameter logistic form
 *
 *     P(θ) = c + (1 − c) / (1 + exp(−a(θ − b)))
 *
 * on the logistic metric (no D = 1.702 scaling constant). The Rasch/1PL model
 * is a = 1, c = 0; the 2PL is c = 0.
 *
 * Nothing in this file says where a, b and c come from. That is the job of
 * `parameters.ts`, which keeps provisional (a priori) parameters strictly
 * apart from empirically calibrated ones.
 */

export interface ItemParameters {
  /** Discrimination (slope). */
  a: number;
  /** Difficulty (location) on the θ metric. */
  b: number;
  /** Lower asymptote ("pseudo-guessing"). 0 for free-response items. */
  c: number;
}

export interface ScoredResponse {
  params: ItemParameters;
  correct: boolean;
}

const P_MIN = 1e-10;
const P_MAX = 1 - 1e-10;

export function probability(theta: number, p: ItemParameters): number {
  const logistic = 1 / (1 + Math.exp(-p.a * (theta - p.b)));
  const prob = p.c + (1 - p.c) * logistic;
  return Math.min(P_MAX, Math.max(P_MIN, prob));
}

/**
 * Fisher information of a dichotomous 3PL item at θ:
 *
 *     I(θ) = a² · ((P − c)² / (1 − c)²) · ((1 − P) / P)
 *
 * which reduces to a²·P·(1 − P) when c = 0.
 */
export function information(theta: number, p: ItemParameters): number {
  const prob = probability(theta, p);
  const num = (prob - p.c) * (prob - p.c);
  const den = (1 - p.c) * (1 - p.c);
  return p.a * p.a * (num / den) * ((1 - prob) / prob);
}

export function testInformation(theta: number, items: readonly ItemParameters[]): number {
  let total = 0;
  for (const p of items) total += information(theta, p);
  return total;
}

export function logLikelihood(theta: number, responses: readonly ScoredResponse[]): number {
  let ll = 0;
  for (const r of responses) {
    const prob = probability(theta, r.params);
    ll += r.correct ? Math.log(prob) : Math.log(1 - prob);
  }
  return ll;
}

/**
 * The θ at which a 3PL item is most informative. For c = 0 this is b; with a
 * guessing floor the peak moves slightly above b (Birnbaum, 1968; Lord, 1980).
 */
export function thetaOfMaxInformation(p: ItemParameters): number {
  if (p.c <= 0) return p.b;
  return p.b + Math.log((1 + Math.sqrt(1 + 8 * p.c)) / 2) / p.a;
}
