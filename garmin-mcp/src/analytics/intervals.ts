/**
 * Interval session analysis: detect structure and quality.
 * Identifies patterns like "6 x 1000m", "10 x 400m", etc.
 */

export interface IntervalRep {
  index: number;
  distanceM: number;
  durationSec: number;
  paceSecPerKm: number;
  avgHr: number;
  maxHr: number;
  peakPower?: number;
}

export interface IntervalRecovery {
  index: number;
  distanceM: number;
  durationSec: number;
  avgHr: number;
}

export interface IntervalQuality {
  consistency: "excellent" | "good" | "moderate" | "poor";
  lateSessionFade: "none" | "small" | "moderate" | "large";
  recoveryQuality: "good" | "adequate" | "slow";
}

export interface IntervalAnalysis {
  detected: boolean;
  structure?: string; // e.g., "6 x 1000m"
  workReps?: IntervalRep[];
  recoveries?: IntervalRecovery[];
  numReps?: number;
  avgRepDurationSec?: number;
  avgWorkPaceSecPerKm?: number;
  fastestRepSecPerKm?: number;
  slowestRepSecPerKm?: number;
  paceCV?: number; // coefficient of variation: stdDev / mean
  paceDecayPct?: number; // % slower from first to last rep
  avgHrFirstHalf?: number;
  avgHrSecondHalf?: number;
  peakHr?: number;
  recoveryDurationAvgSec?: number;
  quality?: IntervalQuality;
  reason?: string; // If not detected, why not
}

interface LapSummary {
  index: number;
  distanceM: number;
  durationSec: number;
  avgHr?: number;
  maxHr?: number;
  avgPace?: number;
}

/**
 * Parse lap data into work/recovery structure.
 * Assumes laps are ordered chronologically.
 *
 * Heuristic:
 * - Work laps: faster pace OR higher HR
 * - Recovery laps: slower pace OR lower HR
 * - Threshold: if pace varies >15% between laps, likely work/recovery split
 */
function identifyWorkRecoveryLaps(laps: LapSummary[]): { work: LapSummary[]; recovery: LapSummary[] } {
  if (laps.length < 2) return { work: [], recovery: [] };

  const paces = laps.map((l) => l.avgPace ?? 0).filter((p) => p > 0);
  if (paces.length === 0) return { work: [], recovery: [] };

  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);
  const paceRange = maxPace - minPace;

  // If no significant pace variation, can't detect intervals
  if (paceRange < minPace * 0.08) return { work: [], recovery: [] };

  // Threshold: laps faster than midpoint are work, slower are recovery
  const midPace = (minPace + maxPace) / 2;

  const work = laps.filter((l) => (l.avgPace ?? 0) < midPace);
  const recovery = laps.filter((l) => (l.avgPace ?? 0) >= midPace);

  return { work, recovery };
}

/**
 * Calculate coefficient of variation for pace consistency.
 */
function paceCV(paces: number[]): number {
  if (paces.length < 2) return 0;
  const mean = paces.reduce((a, b) => a + b) / paces.length;
  if (mean === 0) return 0;
  const variance = paces.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / paces.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Detect interval structure from lap data.
 * Returns detected=true if clear repeated work/recovery pattern found.
 */
export function analyzeIntervals(laps: any[]): IntervalAnalysis {
  if (!Array.isArray(laps) || laps.length < 3) {
    return { detected: false, reason: "insufficient laps (<3)" };
  }

  // Convert Garmin laps to internal format
  const lapSummaries: LapSummary[] = laps.map((lap: any, i: number) => ({
    index: i,
    distanceM: lap.distance ?? 0,
    durationSec: (lap.duration ?? 0),
    avgHr: lap.averageHR,
    maxHr: lap.maxHR,
    avgPace: lap.avgPace ? lap.avgPace : lap.duration > 0 ? (lap.distance / (lap.duration / 3600)) * 1000 : 0,
  }));

  const { work, recovery } = identifyWorkRecoveryLaps(lapSummaries);

  // Need at least 3 work reps to call it intervals
  if (work.length < 3) {
    return { detected: false, reason: `only ${work.length} work intervals` };
  }

  // Check for consistent rep structure
  const repDistances = work.map((w) => w.distanceM);
  const repDurations = work.map((w) => w.durationSec);

  const firstDist = repDistances[0] ?? 0;
  const distStdDev = Math.sqrt(repDistances.reduce((sum, d) => sum + Math.pow(d - firstDist, 2), 0) / repDistances.length);
  const distCV = firstDist > 0 ? distStdDev / firstDist : 0;

  // If reps vary >20% in distance, may not be structured intervals
  if (distCV > 0.2) {
    return { detected: false, reason: "rep distances inconsistent (>20% variation)" };
  }

  // Construct interval reps
  const intervals: IntervalRep[] = work.map((w) => ({
    index: w.index,
    distanceM: w.distanceM,
    durationSec: w.durationSec,
    paceSecPerKm: w.avgPace ? (60 * 1000) / w.avgPace : 0,
    avgHr: w.avgHr ?? 0,
    maxHr: w.maxHr ?? 0,
  }));

  const paces = intervals.map((i) => i.paceSecPerKm).filter((p) => p > 0);
  const avgPace = paces.reduce((a, b) => a + b, 0) / Math.max(paces.length, 1);
  const pace_cv = paceCV(paces);

  // Pace decay: compare first half avg to second half avg
  const firstHalf = intervals.slice(0, Math.ceil(intervals.length / 2));
  const secondHalf = intervals.slice(Math.ceil(intervals.length / 2));

  const firstHalfAvgPace = firstHalf.reduce((sum, i) => sum + i.paceSecPerKm, 0) / firstHalf.length;
  const secondHalfAvgPace = secondHalf.reduce((sum, i) => sum + i.paceSecPerKm, 0) / secondHalf.length;

  const paceDecay = firstHalfAvgPace > 0 ? ((secondHalfAvgPace - firstHalfAvgPace) / firstHalfAvgPace) * 100 : 0;

  // HR progression
  const firstHalfHr = firstHalf.reduce((sum, i) => sum + (i.avgHr ?? 0), 0) / firstHalf.length;
  const secondHalfHr = secondHalf.reduce((sum, i) => sum + (i.avgHr ?? 0), 0) / secondHalf.length;
  const peakHr = Math.max(...intervals.map((i) => i.maxHr));

  // Recovery analysis
  const recoveryDurations = recovery.map((r) => r.durationSec);
  const avgRecoveryDuration = recoveryDurations.reduce((a, b) => a + b, 0) / Math.max(recoveryDurations.length, 1);

  // Quality assessment
  let consistency: IntervalQuality["consistency"] = "moderate";
  if (pace_cv < 0.03) consistency = "excellent";
  else if (pace_cv < 0.06) consistency = "good";
  else if (pace_cv < 0.10) consistency = "moderate";
  else consistency = "poor";

  let lateSessionFade: IntervalQuality["lateSessionFade"] = "small";
  if (paceDecay < 0.5) lateSessionFade = "none";
  else if (paceDecay < 2) lateSessionFade = "small";
  else if (paceDecay < 5) lateSessionFade = "moderate";
  else lateSessionFade = "large";

  let recoveryQuality: IntervalQuality["recoveryQuality"] = "adequate";
  if (secondHalfHr - firstHalfHr < 5) recoveryQuality = "good";
  else if (secondHalfHr - firstHalfHr > 15) recoveryQuality = "slow";

  // Estimate structure string
  const repCount = work.length;
  const avgRepDistM = repDistances[0] ?? 0;
  let structureStr = `${repCount} x`;
  if (avgRepDistM >= 1000) {
    structureStr += ` ${Math.round(avgRepDistM / 1000)}km`;
  } else {
    structureStr += ` ${Math.round(avgRepDistM)}m`;
  }

  // Convert recovery laps to IntervalRecovery format
  const recoveryFormatted: IntervalRecovery[] = recovery.map((r) => ({
    index: r.index,
    distanceM: r.distanceM,
    durationSec: r.durationSec,
    avgHr: r.avgHr ?? 0,
  }));

  return {
    detected: true,
    structure: structureStr,
    workReps: intervals,
    recoveries: recoveryFormatted,
    numReps: work.length,
    avgRepDurationSec: repDurations.reduce((a, b) => a + b, 0) / repDurations.length,
    avgWorkPaceSecPerKm: avgPace,
    fastestRepSecPerKm: Math.min(...paces),
    slowestRepSecPerKm: Math.max(...paces),
    paceCV: pace_cv,
    paceDecayPct: paceDecay,
    avgHrFirstHalf: firstHalfHr,
    avgHrSecondHalf: secondHalfHr,
    peakHr,
    recoveryDurationAvgSec: avgRecoveryDuration,
    quality: {
      consistency,
      lateSessionFade,
      recoveryQuality,
    },
  };
}
