/**
 * Analysis utilities for pilot and norming studies.
 *
 * These are building blocks for the validation roadmap, not a substitute for
 * dedicated psychometric software. Item calibration itself (2PL/3PL marginal
 * maximum likelihood, model fit, dimensionality) should be done in a
 * validated package such as R `mirt` (Chalmers, 2012), using the long-format
 * export below.
 */

import { chiSquare1UpperTail, correlation, mean, variance } from "../psychometrics/stats";
import type { Session } from "../assessment/session";

// ---------------------------------------------------------------------------
// Data export
// ---------------------------------------------------------------------------

export interface LongFormatRow {
  session_id: string;
  mode: string;
  bank_version: string;
  item_id: string;
  item_version: number;
  domain: string;
  family: string;
  section_id: string;
  position: number;
  correct: 0 | 1;
  timed_out: 0 | 1;
  rt_ms: number;
  rapid: 0 | 1;
  resumed: 0 | 1;
  provisional_b: number;
  age_years: number | "";
  english_first_language: string;
  extended_time: 0 | 1;
  primary_pointer: string;
  presented_at: string;
}

/** One row per scored response. Only sessions with research consent are exported. */
export function toLongFormat(sessions: Session[]): LongFormatRow[] {
  const rows: LongFormatRow[] = [];
  for (const s of sessions) {
    if (!s.participant.researchConsent) continue;
    for (const sec of s.sections) {
      if (sec.kind === "speed") continue;
      for (const r of sec.responses) {
        rows.push({
          session_id: s.id,
          mode: s.mode,
          bank_version: s.bankVersion,
          item_id: r.itemId,
          item_version: r.itemVersion,
          domain: r.domain,
          family: r.family,
          section_id: r.sectionId,
          position: r.index,
          correct: r.correct ? 1 : 0,
          timed_out: r.timedOut ? 1 : 0,
          rt_ms: r.rtMs,
          rapid: r.flags.includes("rapid") ? 1 : 0,
          resumed: r.resumed ? 1 : 0,
          provisional_b: r.params.b,
          age_years: s.participant.ageYears ?? "",
          english_first_language: s.participant.englishFirstLanguage ?? "",
          extended_time: s.settings.extendedTime ? 1 : 0,
          primary_pointer: s.environment.primaryPointer,
          presented_at: new Date(r.presentedAt).toISOString(),
        });
      }
    }
  }
  return rows;
}

export function toCsv<T extends object>(rows: T[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc((r as Record<string, unknown>)[h])).join(","))].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

/**
 * Empirical (marginal) reliability of EAP estimates:
 * ρ = Var(θ̂) / (Var(θ̂) + mean(SE²)).
 */
export function marginalReliability(thetas: number[], ses: number[]): number {
  const v = variance(thetas);
  const e = mean(ses.map((s) => s * s));
  return v / (v + e);
}

/** Cronbach's alpha for a complete persons × items matrix of 0/1 scores. */
export function cronbachAlpha(matrix: number[][]): number {
  const k = matrix[0]?.length ?? 0;
  if (k < 2) return NaN;
  const itemVars = Array.from({ length: k }, (_, j) => variance(matrix.map((row) => row[j])));
  const totals = matrix.map((row) => row.reduce((s, x) => s + x, 0));
  return (k / (k - 1)) * (1 - itemVars.reduce((s, x) => s + x, 0) / variance(totals));
}

// ---------------------------------------------------------------------------
// Classical item analysis (fixed-form pilot data)
// ---------------------------------------------------------------------------

export interface ClassicalItemStats {
  item: number;
  pValue: number;
  /** Corrected item–rest correlation; negative values often indicate a miskeyed item. */
  itemRest: number;
}

export function classicalItemAnalysis(matrix: number[][]): ClassicalItemStats[] {
  const k = matrix[0]?.length ?? 0;
  return Array.from({ length: k }, (_, j) => {
    const item = matrix.map((row) => row[j]);
    const rest = matrix.map((row) => row.reduce((s, x, i) => (i === j ? s : s + x), 0));
    return { item: j, pValue: mean(item), itemRest: correlation(item, rest) };
  });
}

// ---------------------------------------------------------------------------
// Differential item functioning: Mantel–Haenszel (Holland & Thayer, 1988)
// ---------------------------------------------------------------------------

export interface MhInput {
  /** 0 = reference group, 1 = focal group. */
  group: 0 | 1;
  /** Matching variable, e.g. total score or binned θ. */
  stratum: number;
  correct: 0 | 1;
}

export interface MhResult {
  alphaMH: number;
  /** ETS delta metric: −2.35 · ln(α_MH). Negative values favour the reference group. */
  deltaMH: number;
  chiSquare: number;
  p: number;
  /**
   * ETS classification (simplified): A negligible (|Δ| < 1 or not significant),
   * C large (|Δ| ≥ 1.5 and significant), B moderate otherwise.
   */
  ets: "A" | "B" | "C";
}

export function mantelHaenszel(data: MhInput[]): MhResult {
  const strata = new Map<number, { a: number; b: number; c: number; d: number }>();
  for (const x of data) {
    const s = strata.get(x.stratum) ?? { a: 0, b: 0, c: 0, d: 0 };
    if (x.group === 0) {
      if (x.correct) s.a++;
      else s.b++;
    } else if (x.correct) s.c++;
    else s.d++;
    strata.set(x.stratum, s);
  }
  let num = 0;
  let den = 0;
  let sumA = 0;
  let sumE = 0;
  let sumV = 0;
  for (const { a, b, c, d } of strata.values()) {
    const t = a + b + c + d;
    if (t < 2) continue;
    num += (a * d) / t;
    den += (b * c) / t;
    const nR = a + b;
    const nF = c + d;
    const m1 = a + c;
    const m0 = b + d;
    sumA += a;
    sumE += (nR * m1) / t;
    sumV += (nR * nF * m1 * m0) / (t * t * (t - 1));
  }
  const alphaMH = den > 0 ? num / den : Infinity;
  const deltaMH = -2.35 * Math.log(alphaMH);
  const chiSquare = sumV > 0 ? (Math.abs(sumA - sumE) - 0.5) ** 2 / sumV : 0;
  const p = chiSquare1UpperTail(chiSquare);
  const significant = p < 0.05;
  const ets: MhResult["ets"] = Math.abs(deltaMH) < 1 || !significant ? "A" : Math.abs(deltaMH) >= 1.5 ? "C" : "B";
  return { alphaMH, deltaMH, chiSquare, p, ets };
}
