/**
 * Assessment engine: a pure state machine over `Session`.
 *
 * The UI asks `currentView()` what to show and reports what happened through
 * the action functions below; each returns a new session object. Nothing here
 * touches the DOM, timers or storage, which is what makes complete sessions
 * testable (and simulatable) headlessly.
 */

import { Rng } from "../random";
import { eap, STANDARD_PRIOR } from "../psychometrics/estimation";
import type { ParameterResolver } from "../psychometrics/parameters";
import { selectItem, type Candidate } from "../psychometrics/selection";
import { checkStop } from "../psychometrics/stopping";
import { SPAN_LENGTHS, type SpanTask } from "../items/generators/memory";
import { scoreResponse, type Item, type ItemBank, type ItemFamily, type ResponseValue } from "../items/types";
import {
  blueprintFor,
  type Blueprint,
  type CatSectionBlueprint,
  type SectionBlueprint,
  type SpanSectionBlueprint,
  type SpeedBlockBlueprint,
  type SpeedSectionBlueprint,
} from "./blueprint";
import {
  SESSION_SCHEMA_VERSION,
  type AccessibilitySettings,
  type BaselineTrial,
  type CatSectionState,
  type CurrentItem,
  type EnvironmentInfo,
  type ItemFlag,
  type ItemResponseRecord,
  type ParticipantInfo,
  type SectionState,
  type Session,
  type SessionEvent,
  type SpanSectionState,
  type SpeedBlockResult,
  type SpeedSectionState,
} from "./session";

// ---------------------------------------------------------------------------
// Bank index
// ---------------------------------------------------------------------------

const SPAN_CODES: Record<SpanTask, string> = {
  "digit-span-forward": "DF",
  "digit-span-backward": "DB",
  "sequence-reordering": "SR",
  "spatial-span": "SS",
};

export class ItemBankIndex {
  readonly version: string;
  private readonly byId: Map<string, Item>;
  private readonly byFamily: Map<ItemFamily, Item[]>;

  constructor(bank: ItemBank) {
    this.version = bank.bankVersion;
    this.byId = new Map(bank.items.map((i) => [i.id, i]));
    this.byFamily = new Map();
    for (const item of bank.items) {
      if (item.practice) continue;
      const list = this.byFamily.get(item.family) ?? [];
      list.push(item);
      this.byFamily.set(item.family, list);
    }
  }

  get(id: string): Item {
    const item = this.byId.get(id);
    if (!item) throw new Error(`Unknown item ${id}`);
    return item;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  pool(families: readonly ItemFamily[]): Item[] {
    return families.flatMap((f) => this.byFamily.get(f) ?? []);
  }

  spanTrialId(task: SpanTask, length: number, trial: 1 | 2): string {
    return `GWM-${SPAN_CODES[task]}-L${length}-T${trial}`;
  }

  speedTrials(task: "symbol-search" | "visual-comparison"): Item[] {
    return this.byFamily.get(task) ?? [];
  }
}

export interface EngineContext {
  bank: ItemBankIndex;
  resolver: ParameterResolver;
  now: () => number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clone = <T>(x: T): T => structuredClone(x);

export function blueprintOf(session: Session): Blueprint {
  return blueprintFor(session.mode);
}

export function sectionBlueprint(session: Session, index = session.sectionIndex): SectionBlueprint {
  return blueprintOf(session).sections[index];
}

export function effectiveTimeLimitMs(item: Item, settings: AccessibilitySettings): number | null {
  if (item.timeLimitSec === null) return null;
  return Math.round(item.timeLimitSec * 1000 * (settings.extendedTime ? 1.5 : 1));
}

/**
 * Responses faster than this are unlikely to reflect an attempt to solve the
 * item ("rapid guessing"; Wise & Kong, 2005). 10% of the expected solution
 * time, bounded to 1.5–10 s, following the normative-threshold idea of Wise &
 * Ma (2012) with the a priori time estimate standing in for observed means.
 */
export function rapidThresholdMs(item: Item): number {
  return Math.min(10_000, Math.max(1_500, item.estimatedTimeSec * 100));
}

function initialSection(bp: SectionBlueprint): SectionState {
  const base = {
    id: bp.id,
    status: "pending" as const,
    startedAt: null,
    completedAt: null,
    activeMs: 0,
    practiceIndex: 0,
    practice: [],
  };
  if (bp.kind === "cat") {
    return { ...base, kind: "cat", responses: [], theta: STANDARD_PRIOR.mean, se: STANDARD_PRIOR.sd, current: null, stopReason: null };
  }
  if (bp.kind === "span") {
    return {
      ...base,
      kind: "span",
      responses: [],
      length: SPAN_LENGTHS[bp.task][0],
      trial: 1,
      failuresAtLength: 0,
      theta: STANDARD_PRIOR.mean,
      se: STANDARD_PRIOR.sd,
      current: null,
      stopReason: null,
    };
  }
  return { ...base, kind: "speed", baseline: null, blocks: [], restarts: 0 };
}

function pushEvent(session: Session, event: Omit<SessionEvent, "at">, ctx: EngineContext) {
  session.events.push({ ...event, at: ctx.now() });
}

function currentSection(session: Session): SectionState | undefined {
  return session.sections[session.sectionIndex];
}

function completeSection(session: Session, ctx: EngineContext) {
  const sec = session.sections[session.sectionIndex];
  sec.status = "complete";
  sec.completedAt = ctx.now();
  if (sec.kind !== "speed") sec.current = null;
  pushEvent(session, { type: "section-completed", sectionId: sec.id }, ctx);
  session.sectionIndex += 1;
  if (session.sectionIndex < session.sections.length) {
    session.sections[session.sectionIndex].status = "intro";
  } else {
    session.completedAt = ctx.now();
  }
}

function newCurrent(item: Item, rng: Rng): CurrentItem {
  return {
    itemId: item.id,
    optionOrder: item.response.kind === "choice" ? rng.shuffle(item.response.options.map((o) => o.id)) : null,
    presentedAt: null,
    elapsedMs: 0,
    resumed: false,
  };
}

function selectNextCat(session: Session, ctx: EngineContext): void {
  const bp = sectionBlueprint(session) as CatSectionBlueprint;
  const sec = currentSection(session) as CatSectionState;
  const administered = new Set(sec.responses.map((r) => r.itemId));
  const available = ctx.bank.pool(bp.families).filter((i) => !administered.has(i.id));
  const stop = checkStop(
    {
      itemsAdministered: sec.responses.length,
      se: sec.se,
      elapsedSec: sec.activeMs / 1000,
      itemsRemaining: available.length,
    },
    bp.stopping,
  );
  if (stop) {
    sec.stopReason = stop;
    completeSection(session, ctx);
    return;
  }
  const rng = Rng.fromState(session.rngState);
  const candidates: Candidate[] = available.map((i) => ({ id: i.id, family: i.family, params: ctx.resolver.resolve(i).params }));
  const sel = selectItem(
    candidates,
    {
      theta: sec.theta,
      administeredFamilies: sec.responses.map((r) => r.family),
      contentTargets: bp.contentTargets as Record<string, number>,
      randomesqueK: bp.randomesqueK,
    },
    rng,
  );
  if (!sel) {
    sec.stopReason = "bank-exhausted";
    completeSection(session, ctx);
    return;
  }
  sec.current = newCurrent(ctx.bank.get(sel.item.id), rng);
  session.rngState = rng.state;
}

function setSpanCurrent(session: Session, ctx: EngineContext): void {
  const bp = sectionBlueprint(session) as SpanSectionBlueprint;
  const sec = currentSection(session) as SpanSectionState;
  const id = ctx.bank.spanTrialId(bp.task, sec.length, sec.trial);
  sec.current = newCurrent(ctx.bank.get(id), Rng.fromState(session.rngState));
}

function enterActive(session: Session, ctx: EngineContext): void {
  const sec = currentSection(session)!;
  sec.status = "active";
  if (sec.kind === "cat") selectNextCat(session, ctx);
  else if (sec.kind === "span") setSpanCurrent(session, ctx);
}

// ---------------------------------------------------------------------------
// Construction and views
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  id: string;
  mode: "quick" | "full";
  seed: number;
  participant: ParticipantInfo;
  settings: AccessibilitySettings;
  environment: EnvironmentInfo;
}

export function createSession(input: CreateSessionInput, ctx: EngineContext): Session {
  const bp = blueprintFor(input.mode);
  const t = ctx.now();
  const sections = bp.sections.map(initialSection);
  sections[0].status = "intro";
  const session: Session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: input.id,
    mode: input.mode,
    blueprintVersion: bp.version,
    bankVersion: ctx.bank.version,
    calibrationId: ctx.resolver.calibrationId,
    createdAt: t,
    updatedAt: t,
    completedAt: null,
    endedEarly: false,
    participant: input.participant,
    settings: input.settings,
    environment: input.environment,
    rngState: new Rng(input.seed).state,
    sectionIndex: 0,
    sections,
    events: [{ type: "session-started", at: t }],
    itemFlags: [],
  };
  return session;
}

export interface SectionProgress {
  sectionNumber: number;
  totalSections: number;
  /** Items answered in this section and the section maximum (adaptive sections). */
  answered: number;
  maximum: number | null;
}

export type View =
  | { type: "section-intro"; section: SectionBlueprint; progress: SectionProgress }
  | { type: "practice"; section: SectionBlueprint; item: Item; practiceIndex: number; practiceTotal: number; progress: SectionProgress }
  | { type: "item"; section: CatSectionBlueprint; item: Item; current: CurrentItem; timeLimitMs: number | null; progress: SectionProgress }
  | { type: "span-trial"; section: SpanSectionBlueprint; item: Item; current: CurrentItem; timeLimitMs: number | null; progress: SectionProgress }
  | { type: "speed-baseline"; section: SpeedSectionBlueprint; trials: number; progress: SectionProgress }
  | {
      type: "speed-block";
      section: SpeedSectionBlueprint;
      block: SpeedBlockBlueprint;
      blockIndex: number;
      trials: Item[];
      practice: Item[];
      progress: SectionProgress;
    }
  | { type: "complete" };

function progressOf(session: Session): SectionProgress {
  const bp = sectionBlueprint(session);
  const sec = currentSection(session)!;
  return {
    sectionNumber: session.sectionIndex + 1,
    totalSections: session.sections.length,
    answered: sec.kind === "speed" ? sec.blocks.length : sec.responses.length,
    maximum: bp.kind === "cat" ? bp.stopping.maxItems : bp.kind === "speed" ? bp.blocks.length : null,
  };
}

export function currentView(session: Session, ctx: EngineContext): View {
  if (session.completedAt !== null || session.sectionIndex >= session.sections.length) return { type: "complete" };
  const bp = sectionBlueprint(session);
  const sec = currentSection(session)!;
  const progress = progressOf(session);
  if (sec.status === "intro" || sec.status === "pending") return { type: "section-intro", section: bp, progress };
  if (sec.status === "practice") {
    return {
      type: "practice",
      section: bp,
      item: ctx.bank.get(bp.practiceItemIds[sec.practiceIndex]),
      practiceIndex: sec.practiceIndex,
      practiceTotal: bp.practiceItemIds.length,
      progress,
    };
  }
  if (bp.kind === "cat" && sec.kind === "cat" && sec.current) {
    const item = ctx.bank.get(sec.current.itemId);
    return { type: "item", section: bp, item, current: sec.current, timeLimitMs: effectiveTimeLimitMs(item, session.settings), progress };
  }
  if (bp.kind === "span" && sec.kind === "span" && sec.current) {
    const item = ctx.bank.get(sec.current.itemId);
    return { type: "span-trial", section: bp, item, current: sec.current, timeLimitMs: effectiveTimeLimitMs(item, session.settings), progress };
  }
  if (bp.kind === "speed" && sec.kind === "speed") {
    if (sec.baseline === null) return { type: "speed-baseline", section: bp, trials: bp.baselineTrials, progress };
    const blockIndex = sec.blocks.length;
    const block = bp.blocks[blockIndex];
    return {
      type: "speed-block",
      section: bp,
      block,
      blockIndex,
      trials: ctx.bank.speedTrials(block.task),
      practice: block.practiceItemIds.map((id) => ctx.bank.get(id)),
      progress,
    };
  }
  throw new Error(`Inconsistent session state in section ${sec.id}`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function touch(session: Session, ctx: EngineContext): Session {
  session.updatedAt = ctx.now();
  return session;
}

/** Leave the section intro: go to practice items if there are any, else start testing. */
export function beginSection(prev: Session, ctx: EngineContext): Session {
  const session = clone(prev);
  const sec = currentSection(session);
  if (!sec || (sec.status !== "intro" && sec.status !== "pending")) return prev;
  const bp = sectionBlueprint(session);
  sec.startedAt = ctx.now();
  pushEvent(session, { type: "section-started", sectionId: sec.id }, ctx);
  if (bp.practiceItemIds.length > 0) sec.status = "practice";
  else enterActive(session, ctx);
  return touch(session, ctx);
}

export function submitPractice(prev: Session, input: { itemId: string; response: ResponseValue | null; rtMs: number }, ctx: EngineContext): Session {
  const session = clone(prev);
  const sec = currentSection(session);
  const bp = sectionBlueprint(session);
  if (!sec || sec.status !== "practice") return prev;
  const expected = bp.practiceItemIds[sec.practiceIndex];
  if (input.itemId !== expected) throw new Error(`Practice response for ${input.itemId}, expected ${expected}`);
  sec.practice.push({ itemId: input.itemId, correct: scoreResponse(ctx.bank.get(input.itemId), input.response), rtMs: input.rtMs });
  sec.practiceIndex += 1;
  if (sec.practiceIndex >= bp.practiceItemIds.length) enterActive(session, ctx);
  return touch(session, ctx);
}

/** Record the moment the current item was first displayed. Idempotent. */
export function markPresented(prev: Session, at: number): Session {
  const sec = currentSection(prev);
  if (!sec || sec.kind === "speed" || !sec.current || sec.current.presentedAt !== null) return prev;
  const session = clone(prev);
  const s = currentSection(session) as CatSectionState | SpanSectionState;
  s.current!.presentedAt = at;
  return session;
}

/** Keep the time already spent on the current item up to date (for recovery). */
export function heartbeat(prev: Session, elapsedMs: number): Session {
  const sec = currentSection(prev);
  if (!sec || sec.kind === "speed" || !sec.current) return prev;
  const session = clone(prev);
  const s = currentSection(session) as CatSectionState | SpanSectionState;
  s.current!.elapsedMs = Math.max(s.current!.elapsedMs, elapsedMs);
  return session;
}

export interface ItemSubmission {
  itemId: string;
  response: ResponseValue | null;
  /** Active time on the item, including any time spent before an interruption. */
  rtMs: number;
  timedOut: boolean;
}

function buildRecord(
  sec: CatSectionState | SpanSectionState,
  item: Item,
  input: ItemSubmission,
  ctx: EngineContext,
): ItemResponseRecord {
  const resolved = ctx.resolver.resolve(item);
  const correct = !input.timedOut && scoreResponse(item, input.response);
  const before = { theta: sec.theta, se: sec.se };
  const history = sec.responses.map((r) => ({ params: r.params, correct: r.correct }));
  const after = eap([...history, { params: resolved.params, correct }], STANDARD_PRIOR);
  const flags: string[] = [];
  if (sec.kind === "cat" && !input.timedOut && input.rtMs < rapidThresholdMs(item)) flags.push("rapid");
  return {
    itemId: item.id,
    itemVersion: item.version,
    family: item.family,
    domain: item.domain,
    sectionId: sec.id,
    index: sec.responses.length,
    presentedAt: sec.current!.presentedAt ?? ctx.now() - input.rtMs,
    rtMs: Math.max(0, Math.round(input.rtMs)),
    response: input.timedOut ? null : input.response,
    correct,
    timedOut: input.timedOut,
    resumed: sec.current!.resumed,
    optionOrder: sec.current!.optionOrder,
    params: resolved.params,
    paramStatus: resolved.status,
    paramSource: resolved.source,
    thetaBefore: before.theta,
    seBefore: before.se,
    thetaAfter: after.theta,
    seAfter: after.se,
    flags,
  };
}

/** Submit the response to the current adaptive item or span trial. */
export function submitItem(prev: Session, input: ItemSubmission, ctx: EngineContext): Session {
  const session = clone(prev);
  const sec = currentSection(session);
  if (!sec || sec.status !== "active" || sec.kind === "speed" || !sec.current) return prev;
  if (sec.current.itemId !== input.itemId) throw new Error(`Response for ${input.itemId}, but current item is ${sec.current.itemId}`);
  const item = ctx.bank.get(input.itemId);
  const record = buildRecord(sec, item, input, ctx);
  sec.responses.push(record);
  sec.theta = record.thetaAfter;
  sec.se = record.seAfter;
  sec.activeMs += record.rtMs;
  sec.current = null;

  if (sec.kind === "cat") {
    selectNextCat(session, ctx);
    return touch(session, ctx);
  }

  // Span procedure: two trials per length; stop when both trials at a length fail.
  const bp = sectionBlueprint(session) as SpanSectionBlueprint;
  if (!record.correct) sec.failuresAtLength += 1;
  if (sec.trial === 1) {
    sec.trial = 2;
  } else if (sec.failuresAtLength >= 2) {
    sec.stopReason = "discontinued";
  } else {
    sec.length += 1;
    sec.trial = 1;
    sec.failuresAtLength = 0;
    if (sec.length > SPAN_LENGTHS[bp.task][1]) sec.stopReason = "max-length";
  }
  if (!sec.stopReason && sec.activeMs >= bp.maxDurationSec * 1000) sec.stopReason = "time-limit";
  if (sec.stopReason) completeSection(session, ctx);
  else setSpanCurrent(session, ctx);
  return touch(session, ctx);
}

export function submitBaseline(prev: Session, trials: BaselineTrial[], ctx: EngineContext): Session {
  const session = clone(prev);
  const sec = currentSection(session);
  if (!sec || sec.kind !== "speed" || sec.status !== "active" || sec.baseline !== null) return prev;
  sec.baseline = trials;
  return touch(session, ctx);
}

export function submitSpeedBlock(prev: Session, result: SpeedBlockResult, ctx: EngineContext): Session {
  const session = clone(prev);
  const sec = currentSection(session);
  if (!sec || sec.kind !== "speed" || sec.status !== "active" || sec.baseline === null) return prev;
  const bp = sectionBlueprint(session) as SpeedSectionBlueprint;
  const expected = bp.blocks[sec.blocks.length];
  if (!expected || expected.task !== result.task) throw new Error(`Unexpected speed block ${result.task}`);
  // Re-score on the engine side rather than trusting the UI's correctness flag.
  const trials = result.trials.map((t) => ({
    ...t,
    correct: scoreResponse(ctx.bank.get(t.itemId), { kind: "binary", value: t.response }),
  }));
  sec.blocks.push({ ...result, trials });
  sec.activeMs += result.durationMs;
  if (sec.blocks.length >= bp.blocks.length) completeSection(session, ctx);
  return touch(session, ctx);
}

/** A speed block was interrupted (e.g. page reload) and must be restarted. */
export function restartSpeedBlock(prev: Session, ctx: EngineContext): Session {
  const session = clone(prev);
  const sec = currentSection(session);
  if (!sec || sec.kind !== "speed") return prev;
  sec.restarts += 1;
  pushEvent(session, { type: "speed-block-restarted", sectionId: sec.id }, ctx);
  return touch(session, ctx);
}

export function recordEvent(prev: Session, event: Omit<SessionEvent, "at">, ctx: EngineContext): Session {
  const session = clone(prev);
  pushEvent(session, { ...event, sectionId: event.sectionId ?? currentSection(session)?.id }, ctx);
  return touch(session, ctx);
}

/**
 * Called when a stored, unfinished session is opened again. An item that had
 * already been shown is marked as resumed: it will continue with the time
 * that was left, and its record will carry the `resumed` flag.
 */
export function resumeSession(prev: Session, ctx: EngineContext): Session {
  if (prev.completedAt !== null) return prev;
  const session = clone(prev);
  const sec = currentSection(session);
  if (sec && sec.kind !== "speed" && sec.current && sec.current.presentedAt !== null) sec.current.resumed = true;
  pushEvent(session, { type: "resumed" }, ctx);
  return touch(session, ctx);
}

/** Stop the assessment now. Completed sections are kept; the rest are marked skipped. */
export function endEarly(prev: Session, ctx: EngineContext): Session {
  if (prev.completedAt !== null) return prev;
  const session = clone(prev);
  for (let i = session.sectionIndex; i < session.sections.length; i++) {
    const s = session.sections[i];
    s.status = "skipped";
    if (s.kind !== "speed") s.current = null;
  }
  session.endedEarly = true;
  session.completedAt = ctx.now();
  session.sectionIndex = session.sections.length;
  pushEvent(session, { type: "ended-early" }, ctx);
  return touch(session, ctx);
}

export function flagItem(prev: Session, flag: Omit<ItemFlag, "at">, ctx: EngineContext): Session {
  const session = clone(prev);
  session.itemFlags.push({ ...flag, at: ctx.now() });
  return touch(session, ctx);
}

export function isFinished(session: Session): boolean {
  return session.completedAt !== null;
}
