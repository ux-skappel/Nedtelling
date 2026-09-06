/**
 * Aerobic efficiency tracking: pace at similar HR over time.
 * Compares compatible sessions (easy/steady runs, similar terrain) to measure fitness progress.
 */

import type { ActivitySummary } from "./metrics.js";

export interface AerobicEfficiencyMetric {
  metric: "pace_at_hr_band" | "hr_at_pace_band";
  band: string; // e.g., "145-150 bpm" or "5:20-5:30 min/km"
  periods: AerobicEfficiencyPeriod[];
  changePct: number; // positive = improved (faster at same HR or lower HR at same pace)
  confidence: "high" | "medium" | "low";
  sampleCount: number;
}

export interface AerobicEfficiencyPeriod {
  month: string; // YYYY-MM
  value: number; // pace (sec/km) or HR (bpm)
  samples: number;
  stdDev?: number;
}

interface EasyRunSession {
  activity: ActivitySummary;
  dateStr: string;
  month: string;
  distance: number;
  pace: number; // sec/km
  avgHR: number;
  elevation?: number; // optional
}

/**
 * Filter activities to likely easy/steady runs for aerobic efficiency comparison.
 *
 * Criteria:
 * - Type contains "running"
 * - Distance > 5km (sufficient for aerobic measurement)
 * - Avg HR < 80% of max (not too intense)
 * - Regular structure (avoid races, intervals)
 */
export function filterEasyRuns(activities: ActivitySummary[], maxHR: number): EasyRunSession[] {
  return activities
    .filter((a) => {
      const typeKey = a.activityType?.typeKey?.toLowerCase() ?? "";
      if (!typeKey.includes("run")) return false;

      const distance = a.distance ?? 0;
      if (distance < 5) return false;

      const avgHR = a.averageHR ?? 0;
      if (avgHR === 0) return false; // Need HR data

      const hrPct = avgHR / maxHR;
      if (hrPct > 0.8) return false; // Too intense for aerobic baseline

      // Avoid activities with high training load relative to distance (likely intervals)
      const trainingLoad = a.activityTrainingLoad ?? 0;
      if (trainingLoad > distance * 20) return false;

      return true;
    })
    .map((a) => {
      const duration = a.duration ?? 0;
      const distance = a.distance ?? 0;
      const pace = duration > 0 ? (duration / (distance / 1000)) : 0;
      const dateStr = a.startTimeGMT ?? "";
      const month = dateStr.substring(0, 7); // YYYY-MM

      return {
        activity: a,
        dateStr,
        month,
        distance,
        pace,
        avgHR: a.averageHR ?? 0,
        elevation: (a as any).totalAscent,
      };
    });
}

/**
 * Group easy runs by month and compute median values.
 */
function aggregateByMonth(
  runs: EasyRunSession[],
  binFn: (run: EasyRunSession) => number,
): Map<string, { values: number[]; month: string }> {
  const grouped = new Map<string, { values: number[]; month: string }>();

  for (const run of runs) {
    if (!grouped.has(run.month)) {
      grouped.set(run.month, { values: [], month: run.month });
    }
    grouped.get(run.month)!.values.push(binFn(run));
  }

  return grouped;
}

/**
 * Compute median of an array.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? 0;
    return (left + right) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Compute standard deviation.
 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Analyze aerobic efficiency: pace at a specific HR band over time.
 *
 * Example:
 * Input: easy runs, HR band 145-150 bpm
 * Output: What pace did athlete maintain at that HR each month?
 *         Improvement = faster pace at same HR
 */
export function analyzeAerobicEfficiency(
  activities: ActivitySummary[],
  maxHR: number,
  hrBandMin: number = 145,
  hrBandMax: number = 150,
  minMonths: number = 2,
): AerobicEfficiencyMetric {
  const easyRuns = filterEasyRuns(activities, maxHR);

  if (easyRuns.length < 3) {
    return {
      metric: "pace_at_hr_band",
      band: `${hrBandMin}-${hrBandMax} bpm`,
      periods: [],
      changePct: 0,
      confidence: "low",
      sampleCount: easyRuns.length,
    };
  }

  // Find runs within HR band
  const runsByMonth = aggregateByMonth(
    easyRuns.filter((r) => r.avgHR >= hrBandMin && r.avgHR <= hrBandMax),
    (r) => r.pace,
  );

  if (runsByMonth.size < minMonths) {
    return {
      metric: "pace_at_hr_band",
      band: `${hrBandMin}-${hrBandMax} bpm`,
      periods: [],
      changePct: 0,
      confidence: "low",
      sampleCount: easyRuns.length,
    };
  }

  // Create sorted periods
  const periods: AerobicEfficiencyPeriod[] = Array.from(runsByMonth.entries())
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
    .map(([month, data]) => {
      const values = data?.values ?? [];
      return {
        month: month ?? "",
        value: median(values),
        samples: values.length,
        stdDev: stdDev(values),
      };
    });

  // Calculate improvement
  const firstPace = periods[0]?.value ?? 0;
  const lastPace = periods[periods.length - 1]?.value ?? 0;
  const changePct = firstPace > 0 ? ((firstPace - lastPace) / firstPace) * 100 : 0;

  // Confidence based on sample size and consistency
  let confidence: "high" | "medium" | "low" = "medium";
  if (periods.length >= 4 && easyRuns.length >= 20) confidence = "high";
  if (periods.length < 2 || easyRuns.length < 5) confidence = "low";

  return {
    metric: "pace_at_hr_band",
    band: `${hrBandMin}-${hrBandMax} bpm`,
    periods,
    changePct,
    confidence,
    sampleCount: easyRuns.length,
  };
}

/**
 * Analyze HR at similar pace over time (inverse: lower HR = improved fitness).
 */
export function analyzeHeartRateAtPace(
  activities: ActivitySummary[],
  paceBandMin: number = 300, // sec/km
  paceBandMax: number = 330,
  minMonths: number = 2,
): AerobicEfficiencyMetric {
  const easyRuns = filterEasyRuns(activities, 200);

  if (easyRuns.length < 3) {
    return {
      metric: "hr_at_pace_band",
      band: `${Math.round(60000 / paceBandMax)}-${Math.round(60000 / paceBandMin)} min/km`,
      periods: [],
      changePct: 0,
      confidence: "low",
      sampleCount: easyRuns.length,
    };
  }

  // Find runs within pace band
  const runsByMonth = aggregateByMonth(
    easyRuns.filter((r) => r.pace >= paceBandMin && r.pace <= paceBandMax),
    (r) => r.avgHR,
  );

  if (runsByMonth.size < minMonths) {
    return {
      metric: "hr_at_pace_band",
      band: `${Math.round(60000 / paceBandMax)}-${Math.round(60000 / paceBandMin)} min/km`,
      periods: [],
      changePct: 0,
      confidence: "low",
      sampleCount: easyRuns.length,
    };
  }

  const periods: AerobicEfficiencyPeriod[] = Array.from(runsByMonth.entries())
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
    .map(([month, data]) => {
      const values = data?.values ?? [];
      return {
        month: month ?? "",
        value: median(values),
        samples: values.length,
        stdDev: stdDev(values),
      };
    });

  // Improvement: lower HR at same pace
  const firstHr = periods[0]?.value ?? 0;
  const lastHr = periods[periods.length - 1]?.value ?? 0;
  const changePct = firstHr > 0 ? ((firstHr - lastHr) / firstHr) * 100 : 0;

  let confidence: "high" | "medium" | "low" = "medium";
  if (periods.length >= 4 && easyRuns.length >= 20) confidence = "high";
  if (periods.length < 2 || easyRuns.length < 5) confidence = "low";

  return {
    metric: "hr_at_pace_band",
    band: `${Math.round(60000 / paceBandMax)}-${Math.round(60000 / paceBandMin)} min/km`,
    periods,
    changePct,
    confidence,
    sampleCount: easyRuns.length,
  };
}
