/**
 * DEVELOPMENT SCORING — what the application reports today.
 *
 * Every number here is either a raw descriptive statistic (items answered,
 * accuracy, response time, longest span, items per minute) or a provisional
 * model-based ability estimate on an *uncalibrated* logit scale anchored to
 * the a priori item difficulties. Nothing here is norm-referenced: no IQ, no
 * percentile, no "above average". Those require a norm sample (see
 * `validated.ts`) and are deliberately impossible to compute from this module.
 */

import { confidenceInterval, eap, STANDARD_PRIOR } from "../psychometrics/estimation";
import { combinedStatus, type ParameterStatus } from "../psychometrics/parameters";
import { median } from "../psychometrics/stats";
import { levelFromLogit } from "../items/difficulty";
import { DOMAIN_LABELS, type DifficultyLevel, type Domain } from "../items/types";
import { blueprintFor } from "../assessment/blueprint";
import type { ItemResponseRecord, Session, SpanSectionState, SpeedBlockResult, SpeedSectionState } from "../assessment/session";
import { relativeProfile, type ProfileEntry } from "./profile";

export interface TrajectoryPoint {
  index: number;
  theta: number;
  se: number;
  b: number;
  correct: boolean;
  family: string;
}

export interface SpanSummary {
  task: string;
  label: string;
  longestCorrect: number | null;
  trialsCorrect: number;
  trialsTotal: number;
  stopReason: string | null;
}

export interface SpeedBlockSummary {
  task: string;
  label: string;
  attempted: number;
  correct: number;
  errors: number;
  /** (correct − errors) per minute, the conventional penalty for guessing on speeded tasks. */
  netPerMinute: number;
  accuracy: number | null;
  medianRtMs: number | null;
  /** Median correct RT minus the participant's own simple-reaction baseline. */
  adjustedMedianMs: number | null;
  inputModality: SpeedBlockResult["inputModality"];
  interrupted: boolean;
  frameIntervalMs: number | null;
}

export interface SpeedSummary {
  baselineMedianMs: number | null;
  baselineAnticipations: number;
  blocks: SpeedBlockSummary[];
}

export interface DomainResult {
  domain: Domain;
  label: string;
  status: "complete" | "partial" | "not-administered";
  scoring: "irt" | "rate";
  parameterStatus: ParameterStatus;
  items: number;
  correct: number;
  accuracy: number | null;
  /** Provisional ability estimate (uncalibrated logit scale). */
  theta: number | null;
  se: number | null;
  ci95: [number, number] | null;
  /** Difficulty level whose band contains the estimate, and the band covered by the 95% interval. */
  level: { estimate: DifficultyLevel; low: DifficultyLevel; high: DifficultyLevel } | null;
  highestLevelCorrect: DifficultyLevel | null;
  stopReasons: string[];
  medianRtMs: number | null;
  timeouts: number;
  rapid: number;
  trajectory: TrajectoryPoint[];
  spans?: SpanSummary[];
  speed?: SpeedSummary;
  notes: string[];
}

export interface ValidityIndicators {
  rapidResponses: number;
  rapidShare: number;
  timeouts: number;
  hiddenEvents: number;
  hiddenMs: number;
  resumedItems: number;
  speedRestarts: number;
  nonStandard: string[];
  warnings: string[];
  level: "ok" | "caution" | "questionable";
}

export interface DevelopmentReport {
  kind: "development";
  sessionId: string;
  mode: Session["mode"];
  bankVersion: string;
  completed: boolean;
  endedEarly: boolean;
  startedAt: number;
  completedAt: number | null;
  totalDurationMs: number | null;
  activeTestingMs: number;
  parameterStatus: ParameterStatus;
  domains: DomainResult[];
  profile: ProfileEntry[] | null;
  overall: { itemsAnswered: number; correct: number; accuracy: number | null; domainsMeasured: number };
  validity: ValidityIndicators;
}

const SPAN_LABELS: Record<string, string> = {
  "digit-span-forward": "Digits forward",
  "digit-span-backward": "Digits backward",
  "sequence-reordering": "Sequence reordering",
  "spatial-span": "Spatial sequence",
};

const SPEED_LABELS: Record<string, string> = {
  "symbol-search": "Symbol search",
  "visual-comparison": "Visual comparison",
};

const DOMAIN_NOTES: Partial<Record<Domain, string>> = {
  Gc: "Verbal items measure acquired knowledge of English and depend on language background, education and culture.",
  Gwm: "Sequences were shown visually, one element per second; spans are not comparable with auditory administration.",
  Gs: "Speed depends on the device, input method and browser. Do not compare with results from other devices.",
  Gv: "Visual-spatial items require normal or corrected vision; there is no non-visual alternative.",
};

function irtDomain(domain: Domain, responses: ItemResponseRecord[], status: DomainResult["status"], stopReasons: string[]): DomainResult {
  const scored = responses.map((r) => ({ params: r.params, correct: r.correct }));
  const est = responses.length ? eap(scored, STANDARD_PRIOR) : null;
  const ci = est ? confidenceInterval(est) : null;
  const correct = responses.filter((r) => r.correct).length;
  const correctLevels = responses.filter((r) => r.correct).map((r) => levelFromLogit(r.params.b));
  // Recomputed along the combined sequence so multi-section domains (working memory) get one path.
  const trajectory: TrajectoryPoint[] = responses.map((r, i) => {
    const e = eap(scored.slice(0, i + 1), STANDARD_PRIOR);
    return { index: i + 1, theta: e.theta, se: e.se, b: r.params.b, correct: r.correct, family: r.family };
  });
  return {
    domain,
    label: DOMAIN_LABELS[domain],
    status,
    scoring: "irt",
    parameterStatus: combinedStatus(responses.map((r) => ({ status: r.paramStatus, source: r.paramSource }))).status,
    items: responses.length,
    correct,
    accuracy: responses.length ? correct / responses.length : null,
    theta: est ? est.theta : null,
    se: est ? est.se : null,
    ci95: ci,
    level: est && ci ? { estimate: levelFromLogit(est.theta), low: levelFromLogit(ci[0]), high: levelFromLogit(ci[1]) } : null,
    highestLevelCorrect: correctLevels.length ? (Math.max(...correctLevels) as DifficultyLevel) : null,
    stopReasons,
    medianRtMs: responses.length ? median(responses.map((r) => r.rtMs)) : null,
    timeouts: responses.filter((r) => r.timedOut).length,
    rapid: responses.filter((r) => r.flags.includes("rapid")).length,
    trajectory,
    notes: DOMAIN_NOTES[domain] ? [DOMAIN_NOTES[domain]!] : [],
  };
}

function summarizeSpeed(sec: SpeedSectionState): SpeedSummary {
  const baseRts = (sec.baseline ?? []).filter((t) => t.rtMs !== null && !t.anticipation).map((t) => t.rtMs!);
  const baselineMedianMs = baseRts.length ? median(baseRts) : null;
  const blocks = sec.blocks.map((b): SpeedBlockSummary => {
    const correct = b.trials.filter((t) => t.correct).length;
    const errors = b.trials.length - correct;
    const correctRts = b.trials.filter((t) => t.correct).map((t) => t.rtMs);
    const med = correctRts.length ? median(correctRts) : null;
    return {
      task: b.task,
      label: SPEED_LABELS[b.task],
      attempted: b.trials.length,
      correct,
      errors,
      netPerMinute: b.durationMs > 0 ? ((correct - errors) * 60_000) / b.durationMs : 0,
      accuracy: b.trials.length ? correct / b.trials.length : null,
      medianRtMs: med,
      adjustedMedianMs: med !== null && baselineMedianMs !== null ? med - baselineMedianMs : null,
      inputModality: b.inputModality,
      interrupted: b.interrupted,
      frameIntervalMs: b.frameIntervalMs,
    };
  });
  return { baselineMedianMs, baselineAnticipations: (sec.baseline ?? []).filter((t) => t.anticipation).length, blocks };
}

function hiddenTime(session: Session): { events: number; ms: number } {
  let events = 0;
  let ms = 0;
  let hiddenAt: number | null = null;
  for (const e of session.events) {
    if (e.type === "visibility-hidden") {
      events++;
      hiddenAt = e.at;
    } else if (e.type === "visibility-visible" && hiddenAt !== null) {
      ms += e.at - hiddenAt;
      hiddenAt = null;
    }
  }
  return { events, ms };
}

export function scoreSession(session: Session): DevelopmentReport {
  const bp = blueprintFor(session.mode);
  const domains: DomainResult[] = [];
  const order: Domain[] = session.mode === "quick" ? ["Gf"] : ["Gf", "Gv", "Gq", "Gwm", "Gs", "Gc"];

  for (const domain of order) {
    const idx = bp.sections.map((s, i) => (s.domain === domain ? i : -1)).filter((i) => i >= 0);
    const secs = idx.map((i) => session.sections[i]);
    const anyDone = secs.some((s) => s.status === "complete");
    const allDone = secs.every((s) => s.status === "complete");
    const status: DomainResult["status"] = allDone ? "complete" : anyDone || secs.some((s) => s.kind !== "speed" && s.responses.length > 0) ? "partial" : "not-administered";

    if (domain === "Gs") {
      const sec = secs[0] as SpeedSectionState | undefined;
      const speed = sec ? summarizeSpeed(sec) : undefined;
      domains.push({
        domain,
        label: DOMAIN_LABELS[domain],
        status: sec && sec.blocks.length ? status : "not-administered",
        scoring: "rate",
        parameterStatus: "provisional",
        items: speed ? speed.blocks.reduce((s, b) => s + b.attempted, 0) : 0,
        correct: speed ? speed.blocks.reduce((s, b) => s + b.correct, 0) : 0,
        accuracy: speed && speed.blocks.length ? speed.blocks.reduce((s, b) => s + b.correct, 0) / Math.max(1, speed.blocks.reduce((s, b) => s + b.attempted, 0)) : null,
        theta: null,
        se: null,
        ci95: null,
        level: null,
        highestLevelCorrect: null,
        stopReasons: [],
        medianRtMs: null,
        timeouts: 0,
        rapid: 0,
        trajectory: [],
        speed,
        notes: [DOMAIN_NOTES.Gs!],
      });
      continue;
    }

    const responses = secs.flatMap((s) => (s.kind === "speed" ? [] : s.responses));
    const stopReasons = secs.map((s) => (s.kind === "speed" ? null : s.stopReason)).filter((r): r is NonNullable<typeof r> => !!r);
    const result = irtDomain(domain, responses, responses.length ? status : "not-administered", stopReasons);
    if (domain === "Gwm") {
      result.spans = secs
        .filter((s): s is SpanSectionState => s.kind === "span")
        .map((s, k) => {
          const task = (bp.sections[idx[k]] as { task: string }).task;
          const lengthsCorrect = s.responses.filter((r) => r.correct).map((r) => Number(/-L(\d+)-/.exec(r.itemId)?.[1] ?? 0));
          return {
            task,
            label: SPAN_LABELS[task],
            longestCorrect: lengthsCorrect.length ? Math.max(...lengthsCorrect) : null,
            trialsCorrect: s.responses.filter((r) => r.correct).length,
            trialsTotal: s.responses.length,
            stopReason: s.stopReason,
          };
        });
    }
    domains.push(result);
  }

  const cat = session.sections.flatMap((s) => (s.kind === "cat" ? s.responses : []));
  const allItems = session.sections.flatMap((s) => (s.kind === "speed" ? [] : s.responses));
  const rapid = cat.filter((r) => r.flags.includes("rapid")).length;
  const rapidShare = cat.length ? rapid / cat.length : 0;
  const timeouts = allItems.filter((r) => r.timedOut).length;
  const hidden = hiddenTime(session);
  const speedSec = session.sections.find((s): s is SpeedSectionState => s.kind === "speed");
  const nonStandard: string[] = [];
  if (session.settings.extendedTime) nonStandard.push("Extended time limits (1.5×) were used.");
  const warnings: string[] = [];
  let level: ValidityIndicators["level"] = "ok";
  if (rapidShare > 0.15) {
    warnings.push(`${Math.round(rapidShare * 100)}% of reasoning answers were given faster than a plausible solution time, which suggests guessing.`);
    level = "questionable";
  } else if (rapidShare > 0.05) {
    warnings.push("Some reasoning answers were given very quickly.");
    level = "caution";
  }
  if (allItems.length && timeouts / allItems.length > 0.3) {
    warnings.push("Many items ran out of time.");
    if (level === "ok") level = "caution";
  }
  if (hidden.events > 3 || hidden.ms > 60_000) {
    warnings.push("The test window was left several times or for a long period.");
    if (level === "ok") level = "caution";
  }
  const resumedItems = allItems.filter((r) => r.resumed).length;
  if (resumedItems > 0) warnings.push(`${resumedItems} item(s) were interrupted and resumed.`);
  if (speedSec && speedSec.restarts > 0) warnings.push("A speed task had to be restarted after an interruption.");
  if (speedSec?.baseline && speedSec.baseline.filter((t) => t.anticipation).length >= 2) {
    warnings.push("Several reaction-time trials were answered before the signal.");
    if (level === "ok") level = "caution";
  }
  if (nonStandard.length) warnings.push("The administration was non-standard (accommodations were used).");
  if (session.endedEarly) warnings.push("The assessment was ended early; only completed sections are reported.");

  const correct = allItems.filter((r) => r.correct).length;
  const irtDomains = domains.filter((d) => d.scoring === "irt" && d.theta !== null);

  return {
    kind: "development",
    sessionId: session.id,
    mode: session.mode,
    bankVersion: session.bankVersion,
    completed: session.completedAt !== null && !session.endedEarly,
    endedEarly: session.endedEarly,
    startedAt: session.createdAt,
    completedAt: session.completedAt,
    totalDurationMs: session.completedAt ? session.completedAt - session.createdAt : null,
    activeTestingMs: session.sections.reduce((s, sec) => s + sec.activeMs, 0),
    parameterStatus: combinedStatus(allItems.map((r) => ({ status: r.paramStatus, source: r.paramSource }))).status,
    domains,
    profile: irtDomains.length >= 3 ? relativeProfile(irtDomains.map((d) => ({ domain: d.domain, theta: d.theta!, se: d.se! }))) : null,
    overall: {
      itemsAnswered: allItems.length,
      correct,
      accuracy: allItems.length ? correct / allItems.length : null,
      domainsMeasured: domains.filter((d) => d.status !== "not-administered").length,
    },
    validity: {
      rapidResponses: rapid,
      rapidShare,
      timeouts,
      hiddenEvents: hidden.events,
      hiddenMs: hidden.ms,
      resumedItems,
      speedRestarts: speedSec?.restarts ?? 0,
      nonStandard,
      warnings,
      level,
    },
  };
}
