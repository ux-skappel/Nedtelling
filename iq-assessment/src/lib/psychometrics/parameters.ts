/**
 * Item parameter resolution: the single place where the engine decides which
 * IRT parameters an item gets, and how trustworthy they are.
 *
 * Two sources exist and are never mixed silently:
 *
 *  1. PROVISIONAL (default, the only source shipped today).
 *     b  = the item's a priori complexity-model logit,
 *     a  = 1 (no discrimination information exists),
 *     c  = 1/k for a k-option selected-response item, 0 for free response.
 *     The 1/k floor is the probability of a correct blind guess; it is a
 *     logical lower bound, not an estimate. These parameters let the
 *     adaptive engine choose sensible next items and report a *provisional*
 *     ability index with model-based uncertainty. They are not calibrated
 *     and must never be presented as such.
 *
 *  2. CALIBRATED. An empirical calibration set (e.g. a 2PL/3PL fit in R
 *     `mirt` on a pilot sample) keyed by item id *and* version. Only when every
 *     item a participant answered in a section resolves to the same
 *     calibration set is that section's estimate considered calibrated.
 *
 * No calibration set ships with this repository, because none exists yet.
 */

import { itemKey, numberOfOptions, type Item } from "../items/types";
import type { ItemParameters } from "./irt";

export type ParameterStatus = "provisional" | "calibrated";

export interface ResolvedParameters {
  params: ItemParameters;
  status: ParameterStatus;
  /** "provisional-1PL-G" or the calibration set id. */
  source: string;
}

export interface CalibratedItemParameters {
  a: number;
  b: number;
  c?: number;
  /** Standard errors of the estimates, if reported by the calibration software. */
  seA?: number;
  seB?: number;
  seC?: number;
  /** Number of examinees who answered this item in the calibration sample. */
  n: number;
}

export interface CalibrationSet {
  id: string;
  /** Only "empirical" sets are accepted. */
  status: "empirical";
  model: "Rasch" | "2PL" | "3PL";
  bankVersion: string;
  /** e.g. "R mirt 1.41, MML-EM, 61 quadrature points" */
  estimation: string;
  sampleSize: number;
  population: string;
  collectedFrom: string;
  collectedTo: string;
  /** How the θ scale was fixed (e.g. "N(0,1) in the calibration sample"). */
  scaleDefinition: string;
  /** Item fit, local dependence and dimensionality checks performed. */
  modelChecks: string[];
  items: Record<string, CalibratedItemParameters>;
}

export const PROVISIONAL_SOURCE = "provisional-1PL-G";

export function provisionalParameters(item: Item): ItemParameters {
  const k = numberOfOptions(item);
  return {
    a: 1,
    b: item.difficulty.logit,
    c: k && k > 1 ? 1 / k : 0,
  };
}

export function validateCalibrationSet(set: CalibrationSet): string[] {
  const problems: string[] = [];
  if (set.status !== "empirical") problems.push("Calibration set status must be 'empirical'.");
  if (!(set.sampleSize > 0)) problems.push("Calibration set must report a positive sample size.");
  for (const [key, p] of Object.entries(set.items)) {
    if (!/^.+@\d+$/.test(key)) problems.push(`Item key ${key} must have the form id@version.`);
    if (!(p.a > 0) || !Number.isFinite(p.a)) problems.push(`${key}: discrimination must be positive and finite.`);
    if (!Number.isFinite(p.b)) problems.push(`${key}: difficulty must be finite.`);
    if (p.c !== undefined && !(p.c >= 0 && p.c < 1)) problems.push(`${key}: lower asymptote must be in [0, 1).`);
    if (set.model !== "3PL" && p.c) problems.push(`${key}: ${set.model} model cannot have a lower asymptote.`);
    if (set.model === "Rasch" && p.a !== 1) problems.push(`${key}: Rasch model requires a = 1.`);
    if (!(p.n > 0)) problems.push(`${key}: item sample size must be positive.`);
  }
  return problems;
}

export class ParameterResolver {
  constructor(private readonly calibration: CalibrationSet | null = null) {
    if (calibration) {
      const problems = validateCalibrationSet(calibration);
      if (problems.length) throw new Error(`Invalid calibration set: ${problems.join(" ")}`);
    }
  }

  get calibrationId(): string | null {
    return this.calibration?.id ?? null;
  }

  resolve(item: Item): ResolvedParameters {
    const cal = this.calibration?.items[itemKey(item)];
    if (this.calibration && cal) {
      return {
        params: { a: cal.a, b: cal.b, c: cal.c ?? 0 },
        status: "calibrated",
        source: this.calibration.id,
      };
    }
    return { params: provisionalParameters(item), status: "provisional", source: PROVISIONAL_SOURCE };
  }
}

/** A section is calibrated only if every response used the same calibration set. */
export function combinedStatus(resolved: readonly Pick<ResolvedParameters, "status" | "source">[]): {
  status: ParameterStatus;
  source: string | null;
} {
  if (resolved.length === 0) return { status: "provisional", source: null };
  const sources = new Set(resolved.map((r) => r.source));
  const allCalibrated = resolved.every((r) => r.status === "calibrated");
  if (allCalibrated && sources.size === 1) return { status: "calibrated", source: [...sources][0] };
  return { status: "provisional", source: PROVISIONAL_SOURCE };
}
