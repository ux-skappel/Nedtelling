/**
 * The active normative data and item calibration.
 *
 * Both are null, and must stay null until a real norming study exists.
 * Do NOT put estimated, simulated, borrowed or "plausible" numbers here:
 * any value in this file is presented to participants as a norm-referenced
 * IQ. Test fixtures live under tests/ and are named FIXTURE_NOT_REAL_*.
 */

import type { CalibrationSet } from "../psychometrics/parameters";
import type { NormTable } from "./types";

export const ACTIVE_CALIBRATION: CalibrationSet | null = null;

export const ACTIVE_NORM_TABLE: NormTable | null = null;
