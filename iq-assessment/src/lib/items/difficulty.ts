/**
 * A priori difficulty model.
 *
 * Each item family has a documented complexity model in the spirit of the
 * cognitive design system approach (Embretson, 1998) and the linear logistic
 * test model (LLTM; Fischer, 1973): difficulty is predicted from structural
 * features (number of rules, rule type, number of elements, rotation angle,
 * number of folds, …) that research has linked to difficulty (e.g. Carpenter,
 * Just & Shell, 1990; Primi, 2001 for matrices; Shepard & Metzler, 1971 for
 * rotation).
 *
 * The *weights* are expert judgement. They have not been estimated from data.
 * The resulting logits are therefore provisional: good enough to order items
 * and to steer an adaptive test, not good enough to report as calibrated IRT
 * difficulties. Pilot data should be used to estimate the weights (LLTM) and
 * then to replace them entirely with item-level calibration.
 */

import type { APrioriDifficulty, DifficultyLevel } from "./types";

/** Level bands on the provisional logit scale (centres at −2, −1, 0, 1, 2). */
export function levelFromLogit(logit: number): DifficultyLevel {
  if (logit < -1.5) return 1;
  if (logit < -0.5) return 2;
  if (logit < 0.5) return 3;
  if (logit < 1.5) return 4;
  return 5;
}

export const LEVEL_BANDS: Record<DifficultyLevel, [number, number]> = {
  1: [-Infinity, -1.5],
  2: [-1.5, -0.5],
  3: [-0.5, 0.5],
  4: [0.5, 1.5],
  5: [1.5, Infinity],
};

export const LEVEL_LABELS: Record<DifficultyLevel, string> = {
  1: "Introductory",
  2: "Basic",
  3: "Intermediate",
  4: "Advanced",
  5: "Expert",
};

export function makeDifficulty(
  method: string,
  logit: number,
  features: APrioriDifficulty["features"],
): APrioriDifficulty {
  const rounded = Math.round(logit * 100) / 100;
  return { logit: rounded, level: levelFromLogit(rounded), method, features };
}

/** Estimated time on task grows with difficulty; the base differs per family. */
export function estimateTime(baseSec: number, level: DifficultyLevel): number {
  return Math.round(baseSec * (0.6 + 0.2 * level));
}
