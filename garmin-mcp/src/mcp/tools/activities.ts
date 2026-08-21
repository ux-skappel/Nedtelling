/** Tools for finding activities and reading their summaries. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "../../config.js";
import * as api from "../../garmin/endpoints.js";
import { paginateWithinBudget, type PageInfo } from "../paging.js";
import { projectAll } from "../project.js";
import { guarded, jsonResult } from "../result.js";
import { activityIdSchema, assertDateOrder, dateSchema, parseActivityId } from "../schema.js";

const LIST_ENDPOINT = "/activitylist-service/activities/search/activities";

export function registerActivityTools(server: McpServer): void {
  server.registerTool(
    "garmin_list_activities",
    {
      title: "List activities",
      description:
        "List activities newest first, with optional type and date filters. Paged by " +
        "`start`/`limit` against Garmin itself, so only the requested window is fetched. " +
        "Use `fields` to project a subset of each summary. Returns Garmin's summaries verbatim.",
      inputSchema: {
        start: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Offset into the activity list; 0 is the most recent activity."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("How many activities to fetch, at most 200. Defaults to 20."),
        activityType: z
          .string()
          .optional()
          .describe("Filter by type key, e.g. running, cycling, swimming, hiking."),
        startDate: dateSchema.optional().describe("Only activities on or after this date."),
        endDate: dateSchema.optional().describe("Only activities on or before this date."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Top-level summary fields to keep. Omit for the full summary."),
      },
    },
    guarded(async (args) => {
      const start = args.start ?? 0;
      const limit = args.limit ?? 20;
      if (args.startDate && args.endDate) assertDateOrder(args.startDate, args.endDate);

      const activities = await api.listActivities({
        start,
        limit,
        activityType: args.activityType,
        startDate: args.startDate,
        endDate: args.endDate,
      });

      const projected = projectAll(activities, args.fields);
      const fitted = paginateWithinBudget(projected, { offset: 0, limit }, getConfig().maxResponseBytes, 2_000);
      const returned = fitted.items.length;
      // Garmin reports no total, so there is more to fetch when the budget cut
      // the window short, or when Garmin filled the window completely.
      const hasMore = returned < activities.length || activities.length === limit;
      const page: PageInfo = {
        offset: start,
        limit,
        returned,
        total: null,
        nextOffset: hasMore ? start + returned : null,
        hasMore,
        ...(fitted.page.limitAdjusted ? { limitAdjusted: true } : {}),
      };

      return jsonResult({
        source: {
          endpoint: LIST_ENDPOINT,
          params: {
            start,
            limit,
            activityType: args.activityType,
            startDate: args.startDate,
            endDate: args.endDate,
          },
        },
        page,
        notes: fitted.page.limitAdjusted
          ? ["Fewer activities were returned than requested to stay inside the response budget."]
          : undefined,
        data: fitted.items,
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity",
    {
      title: "Get activity summary",
      description:
        "Full summary for one activity: totals, device, laps metadata, and every field " +
        "Garmin stores on the activity record. Sample series live in garmin_get_activity_details.",
      inputSchema: {
        activityId: activityIdSchema,
        fields: z.array(z.string()).optional().describe("Top-level fields to keep."),
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const activity = await api.getActivity(activityId);
      const data =
        activity && typeof activity === "object" && args.fields?.length
          ? projectAll([activity], args.fields)[0]
          : activity;
      return jsonResult({
        source: { endpoint: `/activity-service/activity/${activityId}`, params: {} },
        data,
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity_types",
    {
      title: "List activity types",
      description:
        "Garmin's activity type catalogue — the keys accepted by garmin_list_activities.",
      inputSchema: {},
    },
    guarded(async () =>
      jsonResult({
        source: { endpoint: "/activity-service/activity/activityTypes" },
        data: await api.getActivityTypes(),
      }),
    ),
  );
}
