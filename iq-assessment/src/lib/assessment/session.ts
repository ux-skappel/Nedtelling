/**
 * Session state. A session is a plain JSON-serialisable object so it can be
 * persisted after every response (local storage today, a database later) and
 * recovered exactly — including the random generator state, so selection
 * continues as if nothing had happened.
 */

import type { ItemParameters } from "../psychometrics/irt";
import type { ParameterStatus } from "../psychometrics/parameters";
import type { StopReason } from "../psychometrics/stopping";
import type { Domain, ItemFamily, ResponseValue } from "../items/types";
import type { Mode } from "./blueprint";

export const SESSION_SCHEMA_VERSION = 1;

export interface ParticipantInfo {
  /** Age in whole years. Needed for age-referenced norms in the future. */
  ageYears: number | null;
  /** Relevant to interpreting the verbal section. */
  englishFirstLanguage: "yes" | "no" | "prefer-not-to-say" | null;
  /** The participant agreed that their anonymous responses may be exported for research. */
  researchConsent: boolean;
}

export interface AccessibilitySettings {
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  /**
   * 1.5× time limits. A legitimate accommodation, but it makes the
   * administration non-standard, which results must disclose.
   */
  extendedTime: boolean;
}

export interface EnvironmentInfo {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  /** "coarse" for touchscreens, "fine" for mouse/trackpad. */
  primaryPointer: "coarse" | "fine" | "unknown";
}

export interface ItemResponseRecord {
  itemId: string;
  itemVersion: number;
  family: ItemFamily;
  domain: Domain;
  sectionId: string;
  /** 0-based position within the section. */
  index: number;
  /** Wall-clock time the stimulus was first shown (epoch ms). */
  presentedAt: number;
  /** Active response time in ms (stimulus onset to response, excluding time the page was hidden). */
  rtMs: number;
  response: ResponseValue | null;
  correct: boolean;
  timedOut: boolean;
  /** The item was interrupted (reload, crash) and resumed. */
  resumed: boolean;
  /** Option ids in the order they were displayed (choice items). */
  optionOrder: string[] | null;
  params: ItemParameters;
  paramStatus: ParameterStatus;
  paramSource: string;
  thetaBefore: number;
  seBefore: number;
  thetaAfter: number;
  seAfter: number;
  /** "rapid" = faster than a plausible solution time. */
  flags: string[];
}

export interface PracticeRecord {
  itemId: string;
  correct: boolean;
  rtMs: number;
}

export interface CurrentItem {
  itemId: string;
  optionOrder: string[] | null;
  /** Set when the stimulus is first displayed. */
  presentedAt: number | null;
  /** Active time already spent on this item (kept up to date by a heartbeat). */
  elapsedMs: number;
  resumed: boolean;
}

export type SectionStatus = "pending" | "intro" | "practice" | "active" | "complete" | "skipped";

interface SectionStateBase {
  id: string;
  status: SectionStatus;
  startedAt: number | null;
  completedAt: number | null;
  /** Active testing time (sum of response times), excluding intro and practice. */
  activeMs: number;
  practiceIndex: number;
  practice: PracticeRecord[];
}

export interface CatSectionState extends SectionStateBase {
  kind: "cat";
  responses: ItemResponseRecord[];
  theta: number;
  se: number;
  current: CurrentItem | null;
  stopReason: StopReason | null;
}

export type SpanStopReason = "discontinued" | "max-length" | "time-limit";

export interface SpanSectionState extends SectionStateBase {
  kind: "span";
  responses: ItemResponseRecord[];
  length: number;
  trial: 1 | 2;
  failuresAtLength: number;
  theta: number;
  se: number;
  current: CurrentItem | null;
  stopReason: SpanStopReason | null;
}

export interface BaselineTrial {
  foreperiodMs: number;
  /** null = anticipation (responded before the signal) or no response. */
  rtMs: number | null;
  anticipation: boolean;
}

export interface SpeedTrialRecord {
  itemId: string;
  response: 0 | 1;
  correct: boolean;
  rtMs: number;
}

export interface SpeedBlockResult {
  task: "symbol-search" | "visual-comparison";
  durationMs: number;
  trials: SpeedTrialRecord[];
  practice: PracticeRecord[];
  /** Median frame interval measured before the block (ms), as a latency diagnostic. */
  frameIntervalMs: number | null;
  inputModality: "keyboard" | "pointer" | "touch" | "mixed" | "unknown";
  /** The page was hidden at some point during the block. */
  interrupted: boolean;
}

export interface SpeedSectionState extends SectionStateBase {
  kind: "speed";
  baseline: BaselineTrial[] | null;
  blocks: SpeedBlockResult[];
  restarts: number;
}

export type SectionState = CatSectionState | SpanSectionState | SpeedSectionState;

export type SessionEventType =
  | "session-started"
  | "section-started"
  | "section-completed"
  | "visibility-hidden"
  | "visibility-visible"
  | "resumed"
  | "speed-block-restarted"
  | "ended-early";

export interface SessionEvent {
  type: SessionEventType;
  at: number;
  sectionId?: string;
  detail?: string;
}

export interface ItemFlag {
  itemId: string;
  reason: "unclear" | "wrong-key" | "display" | "other";
  note: string;
  at: number;
}

export interface Session {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: string;
  mode: Mode;
  blueprintVersion: string;
  bankVersion: string;
  /** Calibration set in force when the session was run (null = provisional parameters). */
  calibrationId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  endedEarly: boolean;
  participant: ParticipantInfo;
  settings: AccessibilitySettings;
  environment: EnvironmentInfo;
  rngState: number;
  sectionIndex: number;
  sections: SectionState[];
  events: SessionEvent[];
  itemFlags: ItemFlag[];
}

export const DEFAULT_SETTINGS: AccessibilitySettings = {
  largeText: false,
  highContrast: false,
  reducedMotion: false,
  extendedTime: false,
};

export const UNKNOWN_ENVIRONMENT: EnvironmentInfo = {
  userAgent: "unknown",
  screenWidth: 0,
  screenHeight: 0,
  devicePixelRatio: 1,
  primaryPointer: "unknown",
};
