/** Tools for coaching-focused training analysis. Progressive retrieval: snapshot → history → activity details. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as api from "../../garmin/endpoints.js";
import {
  computeWeeklyHistory,
  computeTrainingSnapshot,
  type ActivitySummary,
} from "../../analytics/metrics.js";
import { ToolInputError } from "../../errors.js";
import { guarded, jsonResult } from "../result.js";
import { activityIdSchema, dateSchema, parseActivityId } from "../schema.js";

/**
 * Converts a Garmin activity to our ActivitySummary format for analytics.
 */
function activityToSummary(activity: any): ActivitySummary {
  return {
    activityId: activity.activityId ?? 0,
    activityType: activity.activityType,
    startTimeGMT: activity.startTimeGMT,
    distance: activity.distance ?? 0,
    duration: activity.duration ?? 0,
    averageHR: activity.averageHR,
    maxHR: activity.maxHR,
    calories: activity.calories,
    activityTrainingLoad: activity.activityTrainingLoad,
    totalSteps: activity.totalSteps,
    avgVerticalOscillation: activity.avgVerticalOscillation,
    avgGroundContactTime: activity.avgGroundContactTime,
    aerobicTrainingEffect: activity.aerobicTrainingEffect,
    anaerobicTrainingEffect: activity.anaerobicTrainingEffect,
  };
}

export function registerTrainingTools(server: McpServer): void {
  server.registerTool(
    "garmin_get_training_snapshot",
    {
      title: "Get current training snapshot",
      description:
        "Quick coaching overview of the last year, computed server-side. Returns aggregated metrics " +
        "across 1-week, 4-week, 12-week, and 52-week windows: distance, runs, pace, heart rate, training load, " +
        "intensity trends, recovery score, and detected anomalies. This is the starting point for running-coach " +
        "questions like 'How has my training progressed?' or 'Am I overtraining?' — it pulls only the summaries " +
        "Claude needs, not raw samples.",
      inputSchema: {
        activityType: z
          .string()
          .optional()
          .describe("Filter to one type, e.g. 'running'. Omit for all activities."),
      },
    },
    guarded(async (args) => {
      // Fetch last 52 weeks of activities (rough estimate: ~5 years of data to be safe)
      const end = new Date();
      const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);

      const startDateStr = start.toISOString().split("T")[0];
      const endDateStr = end.toISOString().split("T")[0];

      const activities = await api.listActivities({
        start: 0,
        limit: 200,
        activityType: args.activityType,
        startDate: startDateStr,
        endDate: endDateStr,
      });

      if (!activities || activities.length === 0) {
        return jsonResult({
          source: { endpoint: "/activitylist-service/activities/search/activities" },
          data: {
            message: "No activities found in the last year.",
            snapshot: null,
          },
        });
      }

      // Convert to analytics format and compute snapshot
      const summaries: ActivitySummary[] = activities.map(activityToSummary);
      const snapshot = computeTrainingSnapshot(summaries);

      return jsonResult({
        source: { endpoint: "/activitylist-service/activities/search/activities" },
        data: {
          snapshot,
          activityCount: activities.length,
          note: "Computed server-side. Request specific weeks/activities for deeper analysis.",
        },
      });
    }),
  );

  server.registerTool(
    "garmin_get_weekly_training_history",
    {
      title: "Get weekly training history",
      description:
        "Last N weeks of aggregated training data: distance, count, pace, heart rate, training load, and activity breakdown by type. " +
        "Use this after get_training_snapshot to analyze trends: 'How did I perform week-to-week over the last 12 weeks?' " +
        "Returns weeks sorted newest first.",
      inputSchema: {
        weeks: z
          .number()
          .int()
          .min(1)
          .max(52)
          .default(12)
          .describe("Number of weeks to return. Defaults to 12."),
        activityType: z
          .string()
          .optional()
          .describe("Filter to one type, e.g. 'running'. Omit for all."),
      },
    },
    guarded(async (args) => {
      const weeks = args.weeks || 12;

      // Fetch enough activities to cover requested weeks
      const end = new Date();
      const start = new Date(end.getTime() - weeks * 7 * 24 * 60 * 60 * 1000 - 7 * 24 * 60 * 60 * 1000); // extra week buffer

      const startDateStr = start.toISOString().split("T")[0];
      const endDateStr = end.toISOString().split("T")[0];

      const activities = await api.listActivities({
        start: 0,
        limit: 200,
        activityType: args.activityType,
        startDate: startDateStr,
        endDate: endDateStr,
      });

      if (!activities || activities.length === 0) {
        return jsonResult({
          source: { endpoint: "/activitylist-service/activities/search/activities" },
          data: { weeks: [], note: "No activities found in the requested period." },
        });
      }

      // Compute weekly summaries
      const summaries: ActivitySummary[] = activities.map(activityToSummary);
      const weeklySummaries = computeWeeklyHistory(summaries).slice(0, weeks);

      return jsonResult({
        source: { endpoint: "/activitylist-service/activities/search/activities" },
        data: {
          weeks: weeklySummaries,
          note: "Sorted newest first. Each week includes the activities for that week.",
        },
      });
    }),
  );

  server.registerTool(
    "garmin_get_recent_activities",
    {
      title: "Get recent activity summaries",
      description:
        "Summaries of the last N activities (not raw samples). Includes distance, time, pace, heart rate, training load. " +
        "Use this to identify which activities to deep-dive into with garmin_get_activity_details or garmin_get_activity_laps.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Number of recent activities to return. Defaults to 10."),
        activityType: z
          .string()
          .optional()
          .describe("Filter by type, e.g. 'running'."),
      },
    },
    guarded(async (args) => {
      const limit = args.limit || 10;

      const activities = await api.listActivities({
        start: 0,
        limit,
        activityType: args.activityType,
      });

      if (!activities || activities.length === 0) {
        return jsonResult({
          source: { endpoint: "/activitylist-service/activities/search/activities" },
          data: { activities: [], note: "No activities found." },
        });
      }

      // Project minimal summary info
      const summaries = activities.map((a: any) => ({
        activityId: a.activityId,
        startTimeGMT: a.startTimeGMT,
        activityType: a.activityType?.typeKey || "unknown",
        distance: a.distance ?? 0,
        duration: a.duration ?? 0,
        averageHR: a.averageHR,
        maxHR: a.maxHR,
        calories: a.calories,
        activityTrainingLoad: a.activityTrainingLoad,
      }));

      return jsonResult({
        source: { endpoint: "/activitylist-service/activities/search/activities" },
        data: {
          activities: summaries,
          note: `Returned ${summaries.length} activities. Use activityId with garmin_get_activity_laps or garmin_get_activity_details for deeper analysis.`,
        },
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity_summary",
    {
      title: "Get activity summary (without raw samples)",
      description:
        "Full summary for one activity (totals, HR, pace, training load, splits metadata) " +
        "without downloading per-sample data. Use this to understand what an activity contains before " +
        "requesting garmin_get_activity_details or garmin_get_activity_laps.",
      inputSchema: {
        activityId: activityIdSchema,
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const activity = (await api.getActivity(activityId)) as any;

      if (!activity) {
        throw new ToolInputError(`Activity ${activityId} not found.`);
      }

      // Return summary without sample data
      const summary = {
        activityId: activity.activityId,
        startTimeGMT: activity.startTimeGMT,
        endTimeGMT: activity.endTimeGMT,
        activityType: activity.activityType,
        distance: activity.distance,
        duration: activity.duration,
        averageHR: activity.averageHR,
        maxHR: activity.maxHR,
        minHR: activity.minHR,
        calories: activity.calories,
        activityTrainingLoad: activity.activityTrainingLoad,
        avgVerticalOscillation: activity.avgVerticalOscillation,
        avgGroundContactTime: activity.avgGroundContactTime,
        avgCadence: activity.avgCadence,
        aerobicTrainingEffect: activity.aerobicTrainingEffect,
        anaerobicTrainingEffect: activity.anaerobicTrainingEffect,
        locationName: activity.locationName,
        eventType: activity.eventType,
        avgRunningCadence: activity.avgRunningCadence,
        lapsCount: (activity.lapCount ?? 0) > 0 ? activity.lapCount : 0,
      };

      return jsonResult({
        source: { endpoint: `/activity-service/activity/${activityId}` },
        data: {
          summary,
          note: "Summary only (no samples). Use garmin_get_activity_laps for lap splits or garmin_get_activity_details for per-sample data.",
        },
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity_laps",
    {
      title: "Get activity laps (splits)",
      description:
        "Lap/split breakdown for one activity: time spent in each lap/section, " +
        "pace, heart rate, and training effect per lap. This sits between summary and raw samples: " +
        "use it to understand activity structure and find intervals worth analyzing in detail.",
      inputSchema: {
        activityId: activityIdSchema,
        kind: z
          .enum(["splits", "typedsplits", "split_summaries"])
          .default("splits")
          .describe("Type of split data: 'splits' (default) for manual/auto laps, 'typedsplits' for sport-specific breakdown, 'split_summaries' for Garmin's grouped summaries."),
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const kind = args.kind || "splits";

      const splits = await api.getActivitySplits(activityId, kind as any);

      return jsonResult({
        source: { endpoint: `/activity-service/activity/${activityId}/${kind}` },
        data: splits || { splits: [], message: `No ${kind} data found for this activity.` },
      });
    }),
  );
}
