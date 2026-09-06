/**
 * Server-side metrics calculation for running coaching.
 *
 * Takes raw Garmin activity summaries and computes useful aggregations
 * without transferring raw samples.
 */

export interface ActivitySummary {
  activityId: number;
  activityType?: { typeKey?: string };
  startTimeGMT?: string;
  distance?: number;
  duration?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
  activityTrainingLoad?: number;
  totalSteps?: number;
  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  aerobicTrainingEffect?: number;
  anaerobicTrainingEffect?: number;
  [key: string]: unknown;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  count: number;
  totalDistance: number;
  totalDuration: number;
  totalCalories: number;
  totalTrainingLoad: number;
  avgPace: number; // km/h
  avgHR: number;
  maxHR: number;
  activityBreakdown: Record<string, number>; // type -> count
  runs: ActivitySummary[];
}

export interface MonthlySummary {
  monthStart: string;
  count: number;
  totalDistance: number;
  totalDuration: number;
  totalTrainingLoad: number;
  avgPace: number;
  avgHR: number;
  weeksData: WeeklySummary[];
}

export interface TrainingSnapshot {
  asOf: string;
  lastWeek: {
    distance: number;
    runs: number;
    duration: number;
    avgHR: number;
  };
  last4Weeks: {
    distance: number;
    avgWeeklyDistance: number;
    runs: number;
    avgRunsPerWeek: number;
    avgPace: number;
    avgHR: number;
    trend: "improving" | "stable" | "declining";
  };
  last12Weeks: {
    distance: number;
    avgWeeklyDistance: number;
    runs: number;
    trainingLoad: number;
    avgTrainingLoadPerRun: number;
    longRunDistance: number;
    longRunCount: number;
    qualityRuns: number; // runs with aerobic/anaerobic effect
  };
  last52Weeks: {
    distance: number;
    runs: number;
    avgWeeklyDistance: number;
    bestWeek: {
      weekStart: string;
      distance: number;
      runs: number;
    };
    worstWeek: {
      weekStart: string;
      distance: number;
      runs: number;
    };
    trend: "improving" | "stable" | "declining";
  };
  recentForm: {
    restingHeartRate?: number;
    volumeTrend: "increasing" | "stable" | "decreasing";
    intensityTrend: "high" | "moderate" | "low";
    recoveryScore: number; // 0-100, higher is better (legacy, renamed to loadRiskScore internally)
  };
  anomalies: string[];
  // Enhanced analysis (optional, populated when athlete profile available)
  analysis?: {
    intensityAnalysis?: IntensityAnalysis;
    loadRiskScore?: LoadRiskScore;
  };
}

function toDate(isoString?: string): Date | null {
  return isoString ? new Date(isoString) : null;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  d.setMilliseconds(0);
  return d;
}

function isoDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

function groupByWeek(activities: ActivitySummary[]): Map<string, ActivitySummary[]> {
  const grouped = new Map<string, ActivitySummary[]>();
  for (const activity of activities) {
    const date = toDate(activity.startTimeGMT);
    if (!date) continue;
    const weekStart = getWeekStart(date);
    const key = isoDate(weekStart);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(activity);
  }
  return grouped;
}

function computeWeeklySummary(weekStart: string, activities: ActivitySummary[]): WeeklySummary {
  const totalDistance = activities.reduce((sum, a) => sum + (a.distance ?? 0), 0);
  const totalDuration = activities.reduce((sum, a) => sum + (a.duration ?? 0), 0);
  const totalCalories = activities.reduce((sum, a) => sum + (a.calories ?? 0), 0);
  const totalTrainingLoad = activities.reduce((sum, a) => sum + (a.activityTrainingLoad ?? 0), 0);

  const hrs = activities.map((a) => a.averageHR).filter((h) => h !== undefined) as number[];
  const avgHR = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b) / hrs.length) : 0;
  const maxHR = Math.max(...activities.map((a) => a.maxHR ?? 0));

  const pace = totalDuration > 0 ? (totalDistance / (totalDuration / 3600)) * 1000 : 0; // m/min
  const avgPace = pace > 0 ? Math.round(pace) : 0;

  const activityTypes = activities.map((a) => a.activityType?.typeKey ?? "unknown");
  const breakdown: Record<string, number> = {};
  for (const type of activityTypes) {
    breakdown[type] = (breakdown[type] ?? 0) + 1;
  }

  const weekStartDate = new Date(weekStart);
  const weekEnd = new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000);

  return {
    weekStart,
    weekEnd: isoDate(weekEnd),
    count: activities.length,
    totalDistance,
    totalDuration,
    totalCalories,
    totalTrainingLoad,
    avgPace,
    avgHR,
    maxHR,
    activityBreakdown: breakdown,
    runs: activities,
  };
}

export function computeWeeklyHistory(activities: ActivitySummary[]): WeeklySummary[] {
  const byWeek = groupByWeek(activities);
  const weeks: WeeklySummary[] = [];
  for (const [weekStart, weekActivities] of byWeek) {
    weeks.push(computeWeeklySummary(weekStart, weekActivities));
  }
  weeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  return weeks;
}

export function computeVolumeTrend(weeks: WeeklySummary[]): "improving" | "stable" | "declining" {
  if (weeks.length < 2) return "stable";
  const recent = weeks.slice(0, 2).map((w) => w.totalDistance);
  const older = weeks.slice(2, 4).map((w) => w.totalDistance);
  if (recent.length === 0 || older.length === 0) return "stable";

  const recentAvg = recent.reduce((a, b) => a + b) / recent.length;
  const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b) / older.length : recentAvg;

  const change = (recentAvg - olderAvg) / Math.max(olderAvg, 1);
  if (change > 0.1) return "improving";
  if (change < -0.1) return "declining";
  return "stable";
}

export interface IntensityAnalysis {
  level: "high" | "moderate" | "low";
  hrPercentageOfReserve: number;
  dataSource: "athlete_profile" | "fallback";
  restingHR: number;
  maxHR: number;
}

/**
 * Compute intensity level with athlete-specific HR data.
 * Now uses athleteProfile if available, falls back to defaults.
 */
export function computeIntensityLevel(
  weeks: WeeklySummary[],
  athleteProfile?: { hrMetrics: { restingHR?: number; maxHR?: number } },
): IntensityAnalysis {
  if (weeks.length === 0) return {
    level: "moderate",
    hrPercentageOfReserve: 0,
    dataSource: "fallback",
    restingHR: 50,
    maxHR: 200,
  };

  const recent = weeks[0]!;
  const avgHR = recent.avgHR;

  const restingHR = athleteProfile?.hrMetrics?.restingHR ?? 50;
  const maxHR = athleteProfile?.hrMetrics?.maxHR ?? 200;
  const reserve = Math.max(maxHR - restingHR, 50);
  const intensity = (avgHR - restingHR) / reserve;

  let level: "high" | "moderate" | "low" = "moderate";
  if (intensity > 0.75) level = "high";
  else if (intensity > 0.55) level = "moderate";
  else level = "low";

  return {
    level,
    hrPercentageOfReserve: intensity,
    dataSource: athleteProfile ? "athlete_profile" : "fallback",
    restingHR,
    maxHR,
  };
}

export interface LoadRiskScore {
  score: number; // 0-100, higher = more risk
  signals: {
    volumeSpike: { detected: boolean; pctChange: number };
    intensityTrend: "increasing" | "stable" | "decreasing";
    frequencyRisk: boolean; // too many hard days
  };
  source: "volume_only" | "enhanced"; // enhanced if more signals available
}

/**
 * Compute overtraining/load risk score (renamed from recoveryScore for accuracy).
 *
 * Higher score = higher risk. Based primarily on:
 * - Recent volume spike (>20% week-over-week)
 * - Intensity concentration (many high-intensity days)
 * - Limited recovery days
 *
 * Not a true recovery score (would need HRV, resting HR, sleep data).
 * Use only for acute load management.
 */
export function computeLoadRiskScore(weeks: WeeklySummary[]): LoadRiskScore {
  if (weeks.length === 0) {
    return {
      score: 50,
      signals: {
        volumeSpike: { detected: false, pctChange: 0 },
        intensityTrend: "stable",
        frequencyRisk: false,
      },
      source: "volume_only",
    };
  }

  const recent = weeks[0]!;
  const prev = weeks.length > 1 ? weeks[1]! : recent;

  // Volume spike penalty
  const volumeChange = recent.totalDistance > 0 && prev.totalDistance > 0
    ? (recent.totalDistance - prev.totalDistance) / prev.totalDistance
    : 0;
  const volumeSpikePenalty = Math.min(Math.max(volumeChange, 0) * 40, 40); // Max 40 points

  // Intensity trend: compare training loads
  const recentLoad = recent.totalTrainingLoad || 0;
  const prevLoad = prev.totalTrainingLoad || 0;
  let intensityPenalty = 0;
  let intensityTrend: "increasing" | "stable" | "decreasing" = "stable";

  if (recentLoad > prevLoad * 1.15) {
    intensityTrend = "increasing";
    intensityPenalty = 15;
  } else if (recentLoad < prevLoad * 0.85) {
    intensityTrend = "decreasing";
    intensityPenalty = 0;
  }

  // Frequency risk: too many activities without gap
  const frequencyRisk = recent.count > 6; // >6 runs in a week
  const frequencyPenalty = frequencyRisk ? 10 : 0;

  const baseScore = 40; // Start lower (lower risk baseline)
  const totalRisk = baseScore + volumeSpikePenalty + intensityPenalty + frequencyPenalty;

  return {
    score: Math.max(0, Math.min(100, totalRisk)),
    signals: {
      volumeSpike: { detected: volumeChange > 0.2, pctChange: volumeChange * 100 },
      intensityTrend,
      frequencyRisk,
    },
    source: "volume_only",
  };
}

/**
 * Legacy compatibility: wrapper that returns simple number like before.
 */
export function computeRecoveryScore(weeks: WeeklySummary[]): number {
  const riskScore = computeLoadRiskScore(weeks);
  // Invert: low risk = high recovery score
  return Math.max(0, Math.min(100, 100 - riskScore.score));
}

export function computeTrainingSnapshot(activities: ActivitySummary[]): TrainingSnapshot {
  const weeks = computeWeeklyHistory(activities);

  const last1Week = weeks.slice(0, 1);
  const last4Weeks = weeks.slice(0, 4);
  const last12Weeks = weeks.slice(0, 12);
  const last52Weeks = weeks.slice(0, 52);

  const anomalies: string[] = [];

  // Last week summary
  const week1 = last1Week[0];
  const lastWeek = {
    distance: week1?.totalDistance ?? 0,
    runs: week1?.count ?? 0,
    duration: week1?.totalDuration ?? 0,
    avgHR: week1?.avgHR ?? 0,
  };

  // Last 4 weeks summary
  const dist4w = last4Weeks.reduce((sum, w) => sum + w.totalDistance, 0);
  const runs4w = last4Weeks.reduce((sum, w) => sum + w.count, 0);
  const last4Weeks_summary = {
    distance: dist4w,
    avgWeeklyDistance: dist4w / Math.max(last4Weeks.length, 1),
    runs: runs4w,
    avgRunsPerWeek: runs4w / Math.max(last4Weeks.length, 1),
    avgPace: last4Weeks.length > 0 ? Math.round(last4Weeks.map((w) => w.avgPace).reduce((a, b) => a + b) / last4Weeks.length) : 0,
    avgHR: last4Weeks.length > 0 ? Math.round(last4Weeks.map((w) => w.avgHR).reduce((a, b) => a + b) / last4Weeks.length) : 0,
    trend: computeVolumeTrend(last4Weeks),
  };

  // Last 12 weeks summary
  const dist12w = last12Weeks.reduce((sum, w) => sum + w.totalDistance, 0);
  const runs12w = last12Weeks.reduce((sum, w) => sum + w.count, 0);
  const load12w = last12Weeks.reduce((sum, w) => sum + w.totalTrainingLoad, 0);

  const longRuns = last12Weeks
    .flatMap((w) => w.runs)
    .filter((a) => (a.distance ?? 0) > 15)
    .sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0));

  const qualityRuns = last12Weeks
    .flatMap((w) => w.runs)
    .filter((a) => (a.aerobicTrainingEffect ?? 0) + (a.anaerobicTrainingEffect ?? 0) > 2);

  const last12Weeks_summary = {
    distance: dist12w,
    avgWeeklyDistance: dist12w / Math.max(last12Weeks.length, 1),
    runs: runs12w,
    trainingLoad: Math.round(load12w),
    avgTrainingLoadPerRun: runs12w > 0 ? Math.round(load12w / runs12w) : 0,
    longRunDistance: Math.max(...longRuns.map((a) => a.distance ?? 0), 0),
    longRunCount: longRuns.length,
    qualityRuns: qualityRuns.length,
  };

  // Last 52 weeks summary
  const dist52w = last52Weeks.reduce((sum, w) => sum + w.totalDistance, 0);
  const runs52w = last52Weeks.reduce((sum, w) => sum + w.count, 0);

  const bestWeek = last52Weeks.length > 0
    ? last52Weeks.reduce((best, w) => (w.totalDistance > best.totalDistance ? w : best))
    : null;

  const worstWeek = last52Weeks.length > 0
    ? last52Weeks.reduce((worst, w) => (w.totalDistance < worst.totalDistance ? w : worst))
    : null;

  const last52Weeks_summary = {
    distance: dist52w,
    runs: runs52w,
    avgWeeklyDistance: dist52w / Math.max(last52Weeks.length, 1),
    bestWeek: bestWeek ? { weekStart: bestWeek.weekStart, distance: bestWeek.totalDistance, runs: bestWeek.count } : { weekStart: "", distance: 0, runs: 0 },
    worstWeek: worstWeek ? { weekStart: worstWeek.weekStart, distance: worstWeek.totalDistance, runs: worstWeek.count } : { weekStart: "", distance: 0, runs: 0 },
    trend: computeVolumeTrend(last52Weeks),
  };

  // Anomalies
  if (week1 && week1.totalDistance > last4Weeks_summary.avgWeeklyDistance * 1.5) {
    anomalies.push(`Recent week volume spike: ${Math.round(week1.totalDistance)}km (avg: ${Math.round(last4Weeks_summary.avgWeeklyDistance)}km)`);
  }

  const volumeTrendRaw = computeVolumeTrend(last4Weeks);
  const intensityAnalysis = computeIntensityLevel(last4Weeks);
  const recentForm = {
    restingHeartRate: undefined,
    volumeTrend: (volumeTrendRaw === "improving" ? "increasing" : volumeTrendRaw === "declining" ? "decreasing" : "stable") as "increasing" | "stable" | "decreasing",
    intensityTrend: intensityAnalysis.level, // Use just the level, not the full analysis object
    recoveryScore: computeRecoveryScore(last4Weeks),
  };

  return {
    asOf: isoDate(new Date()),
    lastWeek,
    last4Weeks: last4Weeks_summary,
    last12Weeks: last12Weeks_summary,
    last52Weeks: last52Weeks_summary,
    recentForm,
    anomalies,
  };
}
