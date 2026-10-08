/**
 * Stopping rules for an adaptive section. A section ends at the first of:
 *
 *  - the target precision (posterior SD ≤ targetSE) once `minItems` have been
 *    given (a minimum guards against stopping on a lucky early run),
 *  - `maxItems` administered,
 *  - the section's time budget exhausted,
 *  - no eligible items left in the bank.
 */

export interface StoppingRule {
  minItems: number;
  maxItems: number;
  targetSE: number;
  maxDurationSec: number;
}

export type StopReason = "target-precision" | "max-items" | "time-limit" | "bank-exhausted";

export interface StoppingState {
  itemsAdministered: number;
  se: number;
  elapsedSec: number;
  itemsRemaining: number;
}

export function checkStop(state: StoppingState, rule: StoppingRule): StopReason | null {
  if (state.itemsRemaining <= 0) return "bank-exhausted";
  if (state.itemsAdministered >= rule.maxItems) return "max-items";
  if (state.elapsedSec >= rule.maxDurationSec) return "time-limit";
  if (state.itemsAdministered >= rule.minItems && state.se <= rule.targetSE) return "target-precision";
  return null;
}

export const STOP_REASON_TEXT: Record<StopReason, string> = {
  "target-precision": "Reached the target measurement precision",
  "max-items": "Reached the maximum number of items for this section",
  "time-limit": "Reached the time limit for this section",
  "bank-exhausted": "No further suitable items were available",
};
