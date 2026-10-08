/**
 * VALIDATED SCORING — norm-referenced scores, available only with real norms.
 *
 * The conventional IQ metric expresses a standardised ability estimate on a
 * scale with mean 100 and SD 15 in a reference population:
 *
 *     z  = (θ − μ_age) / σ_age        (μ, σ from the norm sample's age band)
 *     IQ = 100 + 15 · z
 *
 * This is only meaningful when θ comes from empirically calibrated item
 * parameters and μ, σ come from a representative norm sample calibrated on
 * the same scale. `checkNormEligibility` enforces every one of those
 * preconditions; if any fails, no norm-referenced number is produced.
 *
 * Standard errors: the domain interval uses the conditional (IRT) standard
 * error of the person's own estimate, transformed to the IQ metric
 * (SE_IQ = 15 · SE_θ / σ_age). The composite interval uses the composite's
 * reliability: SEM = 15 · √(1 − r_xx).
 */

import { normalCdf } from "../psychometrics/stats";
import type { CalibrationSet } from "../psychometrics/parameters";
import type { Domain } from "../items/types";
import type { Session } from "../assessment/session";
import type { NormTable } from "../norms/types";
import { validateNormTable } from "../norms/types";
import type { DevelopmentReport } from "./development";

export type Eligibility = { eligible: true } | { eligible: false; reasons: string[] };

export function checkNormEligibility(
  session: Session,
  report: DevelopmentReport,
  norms: NormTable | null,
  calibration: CalibrationSet | null,
): Eligibility {
  const reasons: string[] = [];
  if (!norms) {
    reasons.push("No validated normative data exist for this test yet, so no IQ score or percentile can be computed.");
    return { eligible: false, reasons };
  }
  reasons.push(...validateNormTable(norms));
  if (!calibration) reasons.push("Item parameters have not been empirically calibrated.");
  else if (calibration.id !== norms.calibrationSetId) reasons.push("The item calibration does not match the one the norms are anchored to.");
  if (report.parameterStatus !== "calibrated") reasons.push("Some responses were scored with provisional (uncalibrated) item parameters.");
  if (session.calibrationId !== norms.calibrationSetId) reasons.push("The session was not administered under the calibration the norms use.");
  if (session.bankVersion !== norms.bankVersion) reasons.push("The item bank version differs from the normed version.");
  if (!norms.modes.includes(session.mode)) reasons.push(`The norms do not cover the ${session.mode} mode.`);
  const age = session.participant.ageYears;
  if (age === null) reasons.push("Age was not provided; norms are age-specific.");
  else if (!norms.ageBands.some((b) => age >= b.minAge && age <= b.maxAge)) reasons.push("Age is outside the range covered by the norms.");
  if (session.settings.extendedTime) reasons.push("Accommodations (extended time) make the administration non-standard for these norms.");
  if (!report.completed) reasons.push("The assessment was not completed.");
  if (report.validity.level === "questionable") reasons.push("Response validity indicators suggest the results may not reflect ability.");
  return reasons.length ? { eligible: false, reasons } : { eligible: true };
}

export interface NormReferencedScore {
  domain: Domain | "composite";
  z: number;
  standardScore: number;
  ci95: [number, number];
  percentile: number;
  /** The score lies outside the range the norms support and is shown at the limit. */
  beyondRange: boolean;
}

function toScore(domain: Domain | "composite", z: number, seIQ: number, range: [number, number]): NormReferencedScore {
  const raw = 100 + 15 * z;
  const clamped = Math.min(range[1], Math.max(range[0], raw));
  return {
    domain,
    z,
    standardScore: Math.round(clamped),
    ci95: [Math.round(Math.max(range[0], raw - 1.96 * seIQ)), Math.round(Math.min(range[1], raw + 1.96 * seIQ))],
    percentile: Math.round(normalCdf(z) * 1000) / 10,
    beyondRange: raw !== clamped,
  };
}

export interface NormReferencedReport {
  kind: "norm-referenced";
  normTableId: string;
  domains: NormReferencedScore[];
  /** Full-scale composite, only when the norms define and justify one. */
  composite: NormReferencedScore | null;
}

/**
 * Compute norm-referenced scores. Throws unless `checkNormEligibility`
 * passes, so a caller cannot accidentally skip the checks.
 */
export function normReferencedScores(
  session: Session,
  report: DevelopmentReport,
  norms: NormTable | null,
  calibration: CalibrationSet | null,
): NormReferencedReport {
  const eligibility = checkNormEligibility(session, report, norms, calibration);
  if (!eligibility.eligible) throw new Error(`Norm-referenced scoring not permitted: ${eligibility.reasons.join(" ")}`);
  const table = norms!;
  const age = session.participant.ageYears!;
  const band = table.ageBands.find((b) => age >= b.minAge && age <= b.maxAge)!;

  const domains: NormReferencedScore[] = [];
  const zByDomain = new Map<Domain, number>();
  for (const d of report.domains) {
    const stats = band.domains[d.domain];
    if (!stats || d.theta === null || d.se === null) continue;
    const z = (d.theta - stats.mean) / stats.sd;
    zByDomain.set(d.domain, z);
    domains.push(toScore(d.domain, z, (15 * d.se) / stats.sd, table.supportedRange));
  }

  let composite: NormReferencedScore | null = null;
  const def = table.composite;
  if (def && band.composite && table.reliability.composite !== undefined && def.domains.every((d) => zByDomain.has(d))) {
    const raw = def.domains.reduce((s, d, i) => s + def.weights[i] * zByDomain.get(d)!, 0);
    const z = (raw - band.composite.mean) / band.composite.sd;
    const sem = 15 * Math.sqrt(1 - table.reliability.composite);
    composite = toScore("composite", z, sem, table.supportedRange);
  }
  return { kind: "norm-referenced", normTableId: table.id, domains, composite };
}
