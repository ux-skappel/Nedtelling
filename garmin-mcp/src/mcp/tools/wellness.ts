/**
 * Daily wellness tools: sleep, all-day heart rate, stress, body battery,
 * respiration, SpO2, HRV, steps and the daily summary.
 *
 * Each of these endpoints returns one document per day, holding a summary plus
 * one or more full-resolution sample series. The tools share one convention:
 * call without `series` to get the summary and an index of what is inside, then
 * call again naming a series to page through its samples.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "../../config.js";
import { withCache } from "../../garmin/cache.js";
import * as api from "../../garmin/endpoints.js";
import { ToolInputError } from "../../errors.js";
import { indexSeries, resolveSeries, summarize } from "../document.js";
import { paginateWithinBudget } from "../paging.js";
import { guarded, jsonResult, type ToolResult } from "../result.js";
import { assertRangeWithin, dateSchema, limitSchema, offsetSchema } from "../schema.js";

const seriesSchema = z
  .string()
  .optional()
  .describe(
    "Name of the sample series to page through. Omit to get the summary plus the list of " +
      "series this day contains, with their lengths.",
  );

interface RespondOptions {
  endpoint: string;
  params: Record<string, unknown>;
  document: unknown;
  series: string | undefined;
  offset: number | undefined;
  limit: number | undefined;
  /** Friendly series name -> Garmin's key. */
  aliases: Record<string, string>;
}

/** Summary-or-series response shared by every daily wellness tool. */
function respondWithDocument(options: RespondOptions): ToolResult {
  const { document, endpoint, params } = options;
  const available = indexSeries(document);

  if (!options.series) {
    return jsonResult({
      source: { endpoint, params },
      notes: available.length
        ? [
            "Sample series were replaced by their lengths. Call again with " +
              `series set to one of: ${available.map((entry) => entry.key).join(", ")}.`,
          ]
        : [],
      data: { summary: summarize(document), series: available, aliases: options.aliases },
    });
  }

  const resolved = resolveSeries(document, options.series, options.aliases);
  if (!resolved) {
    throw new ToolInputError(
      `No series named ${JSON.stringify(options.series)} in this response. ` +
        (available.length
          ? `Available: ${available.map((entry) => entry.key).join(", ")}.`
          : "This day contains no sample series — the device may not have recorded any."),
    );
  }

  const fitted = paginateWithinBudget(
    resolved.items,
    { offset: options.offset, limit: options.limit },
    getConfig().maxResponseBytes,
    2_000,
  );

  return jsonResult({
    source: { endpoint, params: { ...params, series: resolved.key } },
    page: fitted.page,
    notes: fitted.page.limitAdjusted
      ? ["limit was reduced to fit the response budget; continue from page.nextOffset."]
      : [],
    data: { series: resolved.key, samples: fitted.items },
  });
}

const dailyArgs = {
  date: dateSchema.describe("Calendar day, YYYY-MM-DD, in the account's own time zone."),
  series: seriesSchema,
  offset: offsetSchema,
  limit: limitSchema,
};

export function registerWellnessTools(server: McpServer): void {
  server.registerTool(
    "garmin_get_sleep",
    {
      title: "Get sleep for one night",
      description:
        "One night of sleep: the summary and scores, plus every series the watch recorded — " +
        "sleep stages, movement, heart rate, respiration, SpO2, stress, body battery and HRV. " +
        "Call without `series` first to see what this night contains. Samples are unmodified.",
      inputSchema: {
        ...dailyArgs,
        nonSleepBufferMinutes: z
          .number()
          .int()
          .min(0)
          .max(240)
          .optional()
          .describe("Minutes of awake time to include either side of the sleep window. Defaults to 60."),
      },
    },
    guarded(async (args) => {
      const buffer = args.nonSleepBufferMinutes ?? 60;
      const document = await withCache(`sleep:${args.date}:${buffer}`, () =>
        api.getSleep(args.date, buffer),
      );
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/dailySleepData/{displayName}",
        params: { date: args.date, nonSleepBufferMinutes: buffer },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: {
          levels: "sleepLevels",
          stages: "sleepLevels",
          movement: "sleepMovement",
          heartRate: "sleepHeartRate",
          respiration: "wellnessEpochRespirationDataDTOList",
          spo2: "wellnessEpochSPO2DataDTOList",
          stress: "sleepStress",
          bodyBattery: "sleepBodyBattery",
          hrv: "hrvData",
          restlessMoments: "sleepRestlessMoments",
        },
      });
    }),
  );

  server.registerTool(
    "garmin_get_daily_heart_rate",
    {
      title: "Get all-day heart rate",
      description:
        "Every all-day heart-rate sample for one date, as [epochMillis, bpm] pairs, plus resting " +
        "and min/max for the day. Typically a sample every two minutes.",
      inputSchema: dailyArgs,
    },
    guarded(async (args) => {
      const document = await withCache(`hr:${args.date}`, () => api.getDailyHeartRate(args.date));
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/dailyHeartRate/{displayName}",
        params: { date: args.date },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { heartRate: "heartRateValues", values: "heartRateValues" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_stress",
    {
      title: "Get all-day stress and body battery",
      description:
        "All-day stress samples for one date, and the body-battery series recorded alongside them.",
      inputSchema: dailyArgs,
    },
    guarded(async (args) => {
      const document = await withCache(`stress:${args.date}`, () => api.getDailyStress(args.date));
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/dailyStress/{date}",
        params: { date: args.date },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { stress: "stressValuesArray", bodyBattery: "bodyBatteryValuesArray" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_body_battery",
    {
      title: "Get body battery",
      description:
        "Body battery readings across a date range, with the drain and charge events Garmin " +
        "attributes them to. At most 28 days per call.",
      inputSchema: {
        startDate: dateSchema,
        endDate: dateSchema.optional().describe("Defaults to startDate."),
        series: seriesSchema,
        offset: offsetSchema,
        limit: limitSchema,
      },
    },
    guarded(async (args) => {
      const endDate = args.endDate ?? args.startDate;
      assertRangeWithin(args.startDate, endDate, 28);
      const document = await withCache(`bb:${args.startDate}:${endDate}`, () =>
        api.getBodyBatteryReports(args.startDate, endDate),
      );
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/bodyBattery/reports/daily",
        params: { startDate: args.startDate, endDate },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { days: "(root)" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_body_battery_events",
    {
      title: "Get body battery events",
      description: "Discrete body-battery events for one date: naps, stress episodes, activities.",
      inputSchema: dailyArgs,
    },
    guarded(async (args) => {
      const document = await withCache(`bbe:${args.date}`, () => api.getBodyBatteryEvents(args.date));
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/bodyBattery/events/{date}",
        params: { date: args.date },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { events: "(root)" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_respiration",
    {
      title: "Get respiration",
      description: "All-day breathing-rate samples for one date, in breaths per minute.",
      inputSchema: dailyArgs,
    },
    guarded(async (args) => {
      const document = await withCache(`resp:${args.date}`, () => api.getRespiration(args.date));
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/daily/respiration/{date}",
        params: { date: args.date },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { respiration: "respirationValuesArray", values: "respirationValuesArray" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_spo2",
    {
      title: "Get pulse oximetry",
      description: "Blood-oxygen readings for one date, both the continuous samples and the averages.",
      inputSchema: dailyArgs,
    },
    guarded(async (args) => {
      const document = await withCache(`spo2:${args.date}`, () => api.getSpo2(args.date));
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/daily/spo2/{date}",
        params: { date: args.date },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: {
          spo2: "spO2HourlyAverages",
          hourly: "spO2HourlyAverages",
          continuous: "spO2SingleValues",
        },
      });
    }),
  );

  server.registerTool(
    "garmin_get_hrv",
    {
      title: "Get heart-rate variability",
      description:
        "Overnight HRV for one date: the five-minute readings and the baseline Garmin compares " +
        "them against.",
      inputSchema: dailyArgs,
    },
    guarded(async (args) => {
      const document = await withCache(`hrv:${args.date}`, () => api.getHrv(args.date));
      return respondWithDocument({
        endpoint: "/hrv-service/hrv/{date}",
        params: { date: args.date },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { readings: "hrvReadings", hrv: "hrvReadings" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_steps",
    {
      title: "Get intraday steps",
      description:
        "Steps and activity level for one date in fifteen-minute buckets — the finest granularity " +
        "Garmin exposes for step counts.",
      inputSchema: dailyArgs,
    },
    guarded(async (args) => {
      const document = await withCache(`steps:${args.date}`, () => api.getDailySummaryChart(args.date));
      return respondWithDocument({
        endpoint: "/wellness-service/wellness/dailySummaryChart/{displayName}",
        params: { date: args.date },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { buckets: "(root)", steps: "(root)" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_daily_summary",
    {
      title: "Get daily summary",
      description:
        "Garmin's own roll-up for one date: steps, floors, calories, intensity minutes, resting " +
        "heart rate, stress and body-battery bounds.",
      inputSchema: { date: dateSchema },
    },
    guarded(async (args) =>
      jsonResult({
        source: {
          endpoint: "/usersummary-service/usersummary/daily/{displayName}",
          params: { calendarDate: args.date },
        },
        data: await api.getDailySummary(args.date),
      }),
    ),
  );

  server.registerTool(
    "garmin_get_training_readiness",
    {
      title: "Get training readiness",
      description: "Training readiness and its inputs for one date, as Garmin scored them.",
      inputSchema: { date: dateSchema },
    },
    guarded(async (args) =>
      jsonResult({
        source: { endpoint: "/metrics-service/metrics/trainingreadiness/{date}" },
        data: await api.getTrainingReadiness(args.date),
      }),
    ),
  );

  server.registerTool(
    "garmin_get_training_status",
    {
      title: "Get training status",
      description:
        "Aggregated training status for one date: load, acute/chronic balance, VO2 max estimates.",
      inputSchema: { date: dateSchema },
    },
    guarded(async (args) =>
      jsonResult({
        source: { endpoint: "/metrics-service/metrics/trainingstatus/aggregated/{date}" },
        data: await api.getTrainingStatus(args.date),
      }),
    ),
  );

  server.registerTool(
    "garmin_get_weight",
    {
      title: "Get weight and body composition",
      description:
        "Every weight and body-composition entry in a date range, including manual entries and " +
        "smart-scale readings.",
      inputSchema: {
        startDate: dateSchema,
        endDate: dateSchema,
        series: seriesSchema,
        offset: offsetSchema,
        limit: limitSchema,
      },
    },
    guarded(async (args) => {
      assertRangeWithin(args.startDate, args.endDate, 366);
      const document = await withCache(`weight:${args.startDate}:${args.endDate}`, () =>
        api.getWeightRange(args.startDate, args.endDate),
      );
      return respondWithDocument({
        endpoint: "/weight-service/weight/range/{start}/{end}",
        params: { startDate: args.startDate, endDate: args.endDate },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { entries: "dateWeightList", days: "dailyWeightSummaries" },
      });
    }),
  );

  server.registerTool(
    "garmin_get_hrv_range",
    {
      title: "Get HRV across days",
      description: "Daily HRV summaries for a date range, one entry per night.",
      inputSchema: {
        startDate: dateSchema,
        endDate: dateSchema,
        series: seriesSchema,
        offset: offsetSchema,
        limit: limitSchema,
      },
    },
    guarded(async (args) => {
      assertRangeWithin(args.startDate, args.endDate, 366);
      const document = await withCache(`hrvrange:${args.startDate}:${args.endDate}`, () =>
        api.getHrvRange(args.startDate, args.endDate),
      );
      return respondWithDocument({
        endpoint: "/hrv-service/hrv/daily/{start}/{end}",
        params: { startDate: args.startDate, endDate: args.endDate },
        document,
        series: args.series,
        offset: args.offset,
        limit: args.limit,
        aliases: { days: "hrvSummaries" },
      });
    }),
  );
}
