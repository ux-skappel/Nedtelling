/**
 * One function per Garmin Connect endpoint used by the tools.
 *
 * These are deliberately dumb: they build a path, pass the caller's parameters
 * through, and return the parsed response unchanged. Keeping the endpoint map in
 * a single file makes it easy to see what the server can reach.
 */

import { connectApi, download, type RawResponse } from "./client.js";

let displayNameCache: string | null = null;

export interface SocialProfile {
  displayName?: string;
  userName?: string;
  [key: string]: unknown;
}

export async function getSocialProfile(): Promise<SocialProfile> {
  const profile = await connectApi<SocialProfile>("/userprofile-service/socialProfile");
  if (!profile) throw new Error("Garmin returned an empty user profile.");
  return profile;
}

export async function getUserSettings(): Promise<unknown> {
  return connectApi("/userprofile-service/userprofile/user-settings");
}

/**
 * The account's `displayName`, which several wellness endpoints require in the
 * URL path. Cached for the life of the process — it does not change.
 */
export async function getDisplayName(): Promise<string> {
  if (displayNameCache) return displayNameCache;
  const profile = await getSocialProfile();
  const name = profile.displayName ?? profile.userName;
  if (!name) {
    throw new Error("Garmin profile has no displayName; wellness endpoints cannot be addressed.");
  }
  displayNameCache = encodeURIComponent(name);
  return displayNameCache;
}

/* ---------------------------------------------------------------- activities */

export interface ListActivitiesParams {
  start: number;
  limit: number;
  activityType?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

export async function listActivities(params: ListActivitiesParams): Promise<unknown[]> {
  const result = await connectApi<unknown[]>("/activitylist-service/activities/search/activities", {
    params: {
      start: params.start,
      limit: params.limit,
      activityType: params.activityType,
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return result ?? [];
}

export async function getActivity(activityId: string): Promise<unknown> {
  return connectApi(`/activity-service/activity/${activityId}`);
}

export interface ActivityDetails {
  activityId?: number;
  measurementCount?: number;
  metricsCount?: number;
  metricDescriptors?: Array<{ key?: string; metricsIndex?: number; unit?: unknown }>;
  activityDetailMetrics?: Array<{ metrics?: Array<number | null> }>;
  geoPolylineDTO?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function getActivityDetails(
  activityId: string,
  maxChartSize: number,
  maxPolylineSize: number,
): Promise<ActivityDetails> {
  const details = await connectApi<ActivityDetails>(
    `/activity-service/activity/${activityId}/details`,
    { params: { maxChartSize, maxPolylineSize } },
  );
  return details ?? {};
}

export type SplitKind = "splits" | "typedsplits" | "split_summaries";

export async function getActivitySplits(
  activityId: string,
  kind: SplitKind,
): Promise<unknown> {
  return connectApi(`/activity-service/activity/${activityId}/${kind}`);
}

export async function getActivityHrZones(activityId: string): Promise<unknown> {
  return connectApi(`/activity-service/activity/${activityId}/hrTimeInZones`);
}

export async function getActivityWeather(activityId: string): Promise<unknown> {
  return connectApi(`/activity-service/activity/${activityId}/weather`);
}

export async function getActivityExerciseSets(activityId: string): Promise<unknown> {
  return connectApi(`/activity-service/activity/${activityId}/exerciseSets`);
}

export async function getActivityTypes(): Promise<unknown> {
  return connectApi("/activity-service/activity/activityTypes");
}

export type DownloadFormat = "gpx" | "tcx" | "kml" | "csv" | "original";

const DOWNLOAD_PATHS: Record<DownloadFormat, string> = {
  gpx: "/download-service/export/gpx/activity",
  tcx: "/download-service/export/tcx/activity",
  kml: "/download-service/export/kml/activity",
  csv: "/download-service/export/csv/activity",
  original: "/download-service/files/activity",
};

export async function downloadActivityFile(
  activityId: string,
  format: DownloadFormat,
): Promise<RawResponse> {
  return download(`${DOWNLOAD_PATHS[format]}/${activityId}`);
}

/* ----------------------------------------------------------------- wellness */

export async function getDailyHeartRate(date: string): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/dailyHeartRate/${await getDisplayName()}`, {
    params: { date },
  });
}

export async function getSleep(date: string, nonSleepBufferMinutes: number): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/dailySleepData/${await getDisplayName()}`, {
    params: { date, nonSleepBufferMinutes },
  });
}

export async function getDailyStress(date: string): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/dailyStress/${date}`);
}

export async function getBodyBatteryReports(startDate: string, endDate: string): Promise<unknown> {
  return connectApi("/wellness-service/wellness/bodyBattery/reports/daily", {
    params: { startDate, endDate },
  });
}

export async function getBodyBatteryEvents(date: string): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/bodyBattery/events/${date}`);
}

export async function getRespiration(date: string): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/daily/respiration/${date}`);
}

export async function getSpo2(date: string): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/daily/spo2/${date}`);
}

export async function getIntensityMinutes(date: string): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/daily/im/${date}`);
}

/** 15-minute wellness buckets (steps, activity levels) for one day. */
export async function getDailySummaryChart(date: string): Promise<unknown> {
  return connectApi(`/wellness-service/wellness/dailySummaryChart/${await getDisplayName()}`, {
    params: { date },
  });
}

export async function getDailySummary(date: string): Promise<unknown> {
  return connectApi(`/usersummary-service/usersummary/daily/${await getDisplayName()}`, {
    params: { calendarDate: date },
  });
}

export async function getHrv(date: string): Promise<unknown> {
  return connectApi(`/hrv-service/hrv/${date}`);
}

export async function getHrvRange(startDate: string, endDate: string): Promise<unknown> {
  return connectApi(`/hrv-service/hrv/daily/${startDate}/${endDate}`);
}

export async function getWeightRange(startDate: string, endDate: string): Promise<unknown> {
  return connectApi(`/weight-service/weight/range/${startDate}/${endDate}`, {
    params: { includeAll: true },
  });
}

export async function getTrainingReadiness(date: string): Promise<unknown> {
  return connectApi(`/metrics-service/metrics/trainingreadiness/${date}`);
}

export async function getTrainingStatus(date: string): Promise<unknown> {
  return connectApi(`/metrics-service/metrics/trainingstatus/aggregated/${date}`);
}
