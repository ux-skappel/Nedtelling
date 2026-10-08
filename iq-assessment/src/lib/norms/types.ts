/**
 * Normative data model for the FUTURE validated scoring pipeline.
 *
 * No norm table ships with this repository, because no norming study has
 * been run. Creating one requires (at minimum) a representative,
 * age-stratified sample tested under standard conditions, an empirical item
 * calibration on that sample, reliability and validity evidence, and a
 * differential item functioning review. See docs/VALIDATION_ROADMAP.md.
 */

import type { Mode } from "../assessment/blueprint";
import type { Domain } from "../items/types";

export interface NormStats {
  /** Mean of the calibrated θ estimates in this age band of the norm sample. */
  mean: number;
  /** Standard deviation of the calibrated θ estimates in this age band. */
  sd: number;
}

export interface AgeBand {
  minAge: number;
  maxAge: number;
  n: number;
  domains: Partial<Record<Domain, NormStats>>;
  /** Norms for the weighted composite of domain z-scores (see `CompositeDefinition`). */
  composite?: NormStats;
}

export interface CompositeDefinition {
  domains: Domain[];
  weights: number[];
  /** What the composite is claimed to measure and why that claim is justified. */
  rationale: string;
  /** References to the structural-validity evidence (e.g. a confirmatory factor model). */
  evidence: string[];
}

export interface NormTable {
  id: string;
  /** Only "validated" tables are accepted by the scoring pipeline. */
  status: "validated";
  title: string;
  organisation: string;
  population: string;
  country: string;
  collectionPeriod: string;
  sampleSize: number;
  /** The empirical calibration the θ scale is anchored to. */
  calibrationSetId: string;
  bankVersion: string;
  blueprintVersion: string;
  modes: Mode[];
  ageBands: AgeBand[];
  /** Reliability (e.g. marginal reliability) per domain and for the composite. */
  reliability: Partial<Record<Domain | "composite", number>>;
  composite?: CompositeDefinition;
  /** Lowest and highest standard score the norms support (e.g. 55–145). */
  supportedRange: [number, number];
  evidence: {
    reliability: string;
    validity: string[];
    differentialItemFunctioning: string;
  };
  intendedUse: string;
}

export function validateNormTable(t: NormTable): string[] {
  const p: string[] = [];
  if (t.status !== "validated") p.push("Norm table status must be 'validated'.");
  if (!(t.sampleSize > 0)) p.push("Norm table must report its sample size.");
  if (!t.calibrationSetId) p.push("Norm table must name the calibration set its scale is anchored to.");
  if (t.ageBands.length === 0) p.push("Norm table needs at least one age band.");
  for (const b of t.ageBands) {
    if (!(b.maxAge >= b.minAge)) p.push(`Age band ${b.minAge}-${b.maxAge} is invalid.`);
    if (!(b.n > 0)) p.push(`Age band ${b.minAge}-${b.maxAge} must report n.`);
    for (const [d, s] of Object.entries(b.domains)) if (!(s && s.sd > 0)) p.push(`Age band ${b.minAge}-${b.maxAge}: ${d} SD must be positive.`);
  }
  if (t.composite) {
    if (t.composite.domains.length !== t.composite.weights.length) p.push("Composite domains and weights differ in length.");
    if (t.composite.evidence.length === 0) p.push("A composite requires documented structural-validity evidence.");
    if (t.reliability.composite === undefined) p.push("A composite requires a reported reliability.");
  }
  if (t.evidence.validity.length === 0) p.push("Norm table must cite validity evidence.");
  return p;
}
