/**
 * Deterministic running workout classification.
 * Uses behavioral evidence (pace, HR, structure) rather than activity name.
 */

import type { ActivitySummary } from "./metrics.js";
import type { IntervalAnalysis } from "./intervals.js";
import type { AthleteProfile } from "./athleteProfile.js";
import { hrPercentageOfReserve } from "./athleteProfile.js";

export type WorkoutType =
  | "recovery"
  | "easy"
  | "steady"
  | "long_run"
  | "tempo"
  | "threshold"
  | "intervals"
  | "race"
  | "mixed"
  | "unknown";

export interface WorkoutClassification {
  type: WorkoutType;
  confidence: number; // 0-1
  evidence: string[];
}

interface ClassificationScore {
  type: WorkoutType;
  score: number;
  evidence: string[];
}

/**
 * Classify a running activity based on behavioral evidence.
 *
 * Classification rules (simplified):
 * - recovery: short + easy pace + low HR
 * - easy: moderate distance + easy pace + low-moderate HR
 * - steady: longer + steady pace + moderate HR
 * - long_run: distance > 15km or duration > 90 min
 * - tempo: sustained elevated pace + moderate-high HR
 * - threshold: work blocks near lactate threshold HR
 * - intervals: structured repeats (if lapCount > 3)
 * - race: very high pace + very high HR
 * - mixed: combination of intensities
 */
export async function classifyWorkout(
  activity: ActivitySummary,
  intervals: IntervalAnalysis | null,
  profile: AthleteProfile,
): Promise<WorkoutClassification> {
  const scores: ClassificationScore[] = [];

  // Extract key metrics
  const distance = activity.distance ?? 0;
  const duration = activity.duration ?? 0; // seconds
  const durationMinutes = duration / 60;
  const avgHR = activity.averageHR ?? 0;
  const maxHR = activity.maxHR ?? 0;
  const pace = duration > 0 ? (distance / (duration / 3600)) * 1000 : 0; // m/min
  const trainingLoad = activity.activityTrainingLoad ?? 0;

  // HR percentage of reserve
  const avgHRPct = avgHR > 0 ? hrPercentageOfReserve(avgHR, profile) : 0;
  const maxHRPct = maxHR > 0 ? hrPercentageOfReserve(maxHR, profile) : 0;

  // 1. Recovery run
  if (distance < 6 || durationMinutes < 30) {
    scores.push({
      type: "recovery",
      score: distance < 3 && avgHRPct < 0.6 ? 0.95 : 0.7,
      evidence: ["short duration", `${Math.round(distance)}km`, `avg HR ${Math.round(avgHRPct * 100)}%`],
    });
  }

  // 2. Easy run
  if (distance >= 6 && distance < 15 && avgHRPct < 0.65) {
    scores.push({
      type: "easy",
      score: 0.85,
      evidence: [`${Math.round(distance)}km`, `steady easy pace`, `HR ${Math.round(avgHRPct * 100)}% (zone 2)`],
    });
  }

  // 3. Steady run
  if (distance >= 6 && distance < 20 && durationMinutes < 100 && avgHRPct >= 0.65 && avgHRPct < 0.8) {
    scores.push({
      type: "steady",
      score: 0.8,
      evidence: [`${Math.round(distance)}km`, `steady moderate intensity`, `HR ${Math.round(avgHRPct * 100)}% (zone 3)`],
    });
  }

  // 4. Long run (distance-based)
  if ((distance > 15 && avgHRPct < 0.75) || (durationMinutes > 90 && avgHRPct < 0.75)) {
    scores.push({
      type: "long_run",
      score: distance > 15 ? 0.9 : distance > 12 ? 0.7 : 0.5,
      evidence: [`${Math.round(distance)}km`, `${Math.round(durationMinutes)} minutes`, "easy-steady effort"],
    });
  }

  // 5. Tempo run (sustained moderate-high)
  if (!intervals && distance >= 5 && distance < 15 && avgHRPct >= 0.8 && avgHRPct < 0.9) {
    const consistency = activity.aerobicTrainingEffect ?? 0;
    scores.push({
      type: "tempo",
      score: consistency > 1.5 ? 0.85 : 0.6,
      evidence: [`${Math.round(distance)}km`, `sustained effort`, `HR ${Math.round(avgHRPct * 100)}% (zone 4)`],
    });
  }

  // 6. Threshold (work at/near LT)
  if (!intervals && avgHRPct >= 0.85 && avgHRPct < 0.95) {
    scores.push({
      type: "threshold",
      score: trainingLoad > 250 ? 0.75 : 0.55,
      evidence: [`sustained threshold effort`, `avg HR ${Math.round(avgHRPct * 100)}%`, `training load ${Math.round(trainingLoad)}`],
    });
  }

  // 7. Intervals (structured repeats)
  if (intervals && intervals.detected) {
    scores.push({
      type: "intervals",
      score: 0.9,
      evidence: [intervals.structure ?? "intervals", `${intervals.numReps ?? 0} reps`, `avg work pace ${Math.round(intervals.avgWorkPaceSecPerKm ?? 0)}s/km`],
    });
  }

  // 8. Race (very high effort)
  if (maxHRPct > 0.95 || (avgHRPct > 0.9 && distance > 3)) {
    scores.push({
      type: "race",
      score: maxHRPct > 0.98 ? 0.95 : 0.7,
      evidence: ["very high intensity", `max HR ${Math.round(maxHRPct * 100)}%`, `${Math.round(distance)}km effort`],
    });
  }

  // 9. Mixed (wide HR variation suggests mixed intensities)
  if (intervals && intervals.detected && trainingLoad > 300) {
    const hrVariation = maxHR - (activity.averageHR ?? 0);
    if (hrVariation > 30) {
      scores.push({
        type: "mixed",
        score: 0.65,
        evidence: [`mixed intensity structure`, `HR range ${Math.round(activity.averageHR ?? 0)}-${maxHR}`, "variable pace reps"],
      });
    }
  }

  // Select best classification
  if (scores.length === 0) {
    return { type: "unknown", confidence: 0.5, evidence: ["insufficient data"] };
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]!;

  return {
    type: best.type,
    confidence: Math.min(1, best.score),
    evidence: best.evidence,
  };
}
