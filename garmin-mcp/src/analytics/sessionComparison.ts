/**
 * Similar session comparison: find and compare historically similar workouts.
 * Useful for tracking progress on repeated interval structures.
 */

import type { ActivitySummary } from "./metrics.js";
import type { WorkoutClassification } from "./workoutClassification.js";
import type { IntervalAnalysis } from "./intervals.js";

export interface SessionComparison {
  currentActivityId: number;
  sessionType: string; // e.g., "intervals"
  structure?: string; // e.g., "6 x 1000m"
  comparisonsUsed: number;
  historicalActivities: number[];
  trend: {
    workPaceSecPerKm?: number; // delta in sec/km (negative = faster)
    avgWorkHr?: number; // delta in bpm (negative = lower)
    paceDecayPct?: number; // delta in % (negative = less fade)
    recoveryHr?: number; // delta in bpm
  };
  signals: {
    fasterAtLowerHr?: boolean;
    betterConsistency?: boolean;
    lessLateFade?: boolean;
    improvedRecovery?: boolean;
  };
  percentilRank?: number; // rank among historical sessions (0-100)
}

interface ActivityWithMetrics extends ActivitySummary {
  _classification?: WorkoutClassification;
  _intervals?: IntervalAnalysis;
}

/**
 * Similarity score between two sessions (0-1).
 * Higher = more similar.
 */
function sessionSimilarity(current: ActivityWithMetrics, historical: ActivityWithMetrics): number {
  let score = 0;
  let factors = 0;

  // 1. Workout type match (weight: 40%)
  if (
    current._classification?.type === historical._classification?.type &&
    current._classification?.type !== "unknown"
  ) {
    score += 0.4;
  } else if (current._classification?.type === "unknown" || historical._classification?.type === "unknown") {
    // Unknown types harder to match
  } else {
    // Different types, low score
    return 0.1;
  }

  // 2. For intervals, structure match (weight: 30%)
  if (current._intervals?.detected && historical._intervals?.detected) {
    const currentReps = current._intervals.numReps ?? 0;
    const histReps = historical._intervals.numReps ?? 0;
    const currentDist = current._intervals.workReps?.[0]?.distanceM ?? 0;
    const histDist = historical._intervals.workReps?.[0]?.distanceM ?? 0;

    if (currentReps > 0 && histReps > 0) {
      const repSimilarity = 1 - Math.abs(currentReps - histReps) / Math.max(currentReps, histReps);
      const distSimilarity = currentDist > 0 && histDist > 0 ? 1 - Math.abs(currentDist - histDist) / Math.max(currentDist, histDist) : 0;
      score += (repSimilarity + distSimilarity) / 2 * 0.3;
    }
  } else if (!current._intervals?.detected && !historical._intervals?.detected) {
    // Both non-interval sessions
    score += 0.2; // partial credit
  }

  // 3. Distance similarity (weight: 15%)
  const currentDist = current.distance ?? 0;
  const histDist = historical.distance ?? 0;
  if (currentDist > 0 && histDist > 0) {
    const distRatio = Math.min(currentDist, histDist) / Math.max(currentDist, histDist);
    if (distRatio > 0.85) score += 0.15; // within 15%
    else if (distRatio > 0.7) score += 0.1; // within 30%
    else if (distRatio > 0.6) score += 0.05; // within 40%
  }

  // 4. Training load similarity (weight: 15%)
  const currentLoad = current.activityTrainingLoad ?? 0;
  const histLoad = historical.activityTrainingLoad ?? 0;
  if (currentLoad > 0 && histLoad > 0) {
    const loadRatio = Math.min(currentLoad, histLoad) / Math.max(currentLoad, histLoad);
    if (loadRatio > 0.85) score += 0.15;
    else if (loadRatio > 0.7) score += 0.1;
    else if (loadRatio > 0.6) score += 0.05;
  }

  return Math.min(1, score);
}

/**
 * Find historically similar sessions for comparison.
 */
function findSimilarSessions(
  current: ActivityWithMetrics,
  historical: ActivityWithMetrics[],
  minSimilarity: number = 0.7,
  limit: number = 5,
): ActivityWithMetrics[] {
  const scored = historical
    .filter((h) => h.activityId !== current.activityId) // Exclude current
    .map((h) => ({
      activity: h,
      similarity: sessionSimilarity(current, h),
    }))
    .filter((s) => s.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, limit).map((s) => s.activity);
}

/**
 * Compare current session against historical similar sessions.
 */
export function compareToHistorical(
  currentActivity: ActivityWithMetrics,
  historicalActivities: ActivityWithMetrics[],
): SessionComparison {
  const similar = findSimilarSessions(currentActivity, historicalActivities);

  if (similar.length === 0) {
    return {
      currentActivityId: currentActivity.activityId,
      sessionType: currentActivity._classification?.type ?? "unknown",
      comparisonsUsed: 0,
      historicalActivities: [],
      trend: {},
      signals: {},
    };
  }

  // Extract comparable metrics
  const currentPace = currentActivity._intervals?.avgWorkPaceSecPerKm ?? 0;
  const currentHr = currentActivity._intervals?.avgHrFirstHalf ?? currentActivity.averageHR ?? 0;
  const currentDecay = currentActivity._intervals?.paceDecayPct ?? 0;
  const currentRecoveryHr = currentActivity._intervals?.avgHrSecondHalf ?? 0;

  // Average across historical similar sessions
  const histPaces = similar.map((s) => s._intervals?.avgWorkPaceSecPerKm ?? 0).filter((p) => p > 0);
  const histHrs = similar.map((s) => s._intervals?.avgHrFirstHalf ?? s.averageHR ?? 0).filter((h) => h > 0);
  const histDecays = similar.map((s) => s._intervals?.paceDecayPct ?? 0);
  const histRecoveryHrs = similar.map((s) => s._intervals?.avgHrSecondHalf ?? 0).filter((h) => h > 0);

  const avgHistPace = histPaces.reduce((a, b) => a + b, 0) / Math.max(histPaces.length, 1);
  const avgHistHr = histHrs.reduce((a, b) => a + b, 0) / Math.max(histHrs.length, 1);
  const avgHistDecay = histDecays.reduce((a, b) => a + b, 0) / Math.max(histDecays.length, 1);
  const avgHistRecoveryHr = histRecoveryHrs.reduce((a, b) => a + b, 0) / Math.max(histRecoveryHrs.length, 1);

  // Compute trends (negative = improvement)
  const trend = {
    workPaceSecPerKm: currentPace > 0 && avgHistPace > 0 ? currentPace - avgHistPace : undefined,
    avgWorkHr: currentHr > 0 && avgHistHr > 0 ? currentHr - avgHistHr : undefined,
    paceDecayPct: currentDecay !== 0 && avgHistDecay !== 0 ? currentDecay - avgHistDecay : undefined,
    recoveryHr: currentRecoveryHr > 0 && avgHistRecoveryHr > 0 ? currentRecoveryHr - avgHistRecoveryHr : undefined,
  };

  // Performance signals
  const signals = {
    fasterAtLowerHr: (trend.workPaceSecPerKm ?? 0) < -1 && (trend.avgWorkHr ?? 0) < 0,
    betterConsistency: currentActivity._intervals?.quality?.consistency === "good" || currentActivity._intervals?.quality?.consistency === "excellent",
    lessLateFade: (trend.paceDecayPct ?? 0) < -1,
    improvedRecovery: (trend.recoveryHr ?? 0) < -2,
  };

  // Percentile rank among similar sessions (simplistic: average historical rank)
  const rankScores = similar.map((s) => {
    let rank = 0;
    if (currentPace > 0 && (s._intervals?.avgWorkPaceSecPerKm ?? 0) > currentPace) rank += 1;
    if (currentHr > 0 && (s._intervals?.avgHrFirstHalf ?? s.averageHR ?? 0) > currentHr) rank += 1;
    if (currentDecay < (s._intervals?.paceDecayPct ?? 0)) rank += 1;
    return rank;
  });

  const avgRank = rankScores.reduce((a, b) => a + b, 0) / Math.max(rankScores.length, 1);
  const percentilRank = Math.round((avgRank / 3) * 100); // Normalize to 0-100

  return {
    currentActivityId: currentActivity.activityId,
    sessionType: currentActivity._classification?.type ?? "unknown",
    structure: currentActivity._intervals?.structure,
    comparisonsUsed: similar.length,
    historicalActivities: similar.map((s) => s.activityId),
    trend,
    signals,
    percentilRank,
  };
}
