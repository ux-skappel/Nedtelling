/**
 * Tools for the per-sample series inside an activity: every recorded metric,
 * the GPS track, laps, and heart-rate zones.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "../../config.js";
import { withCache } from "../../garmin/cache.js";
import * as api from "../../garmin/endpoints.js";
import type { ActivityDetails } from "../../garmin/endpoints.js";
import { ToolInputError } from "../../errors.js";
import { paginateWithinBudget } from "../paging.js";
import { guarded, jsonResult } from "../result.js";
import { activityIdSchema, limitSchema, offsetSchema, parseActivityId } from "../schema.js";
import { availableChannels, decodeSamples, readDescriptors, readRows, firstPresent } from "../series.js";

/** Sample-count ceiling per request. Garmin downsamples above what it will send. */
const MAX_CHART_SIZE = 100_000;
const DEFAULT_CHART_SIZE = 20_000;
const DEFAULT_POLYLINE_SIZE = 20_000;

const TIMESTAMP_KEYS = ["directTimestamp", "sumElapsedDuration", "sumDuration"] as const;
const LATITUDE_KEYS = ["directLatitude"] as const;
const LONGITUDE_KEYS = ["directLongitude"] as const;
const ELEVATION_KEYS = ["directElevation", "directGpsElevation"] as const;
const HEART_RATE_KEYS = ["directHeartRate"] as const;

/**
 * Fetches an activity's detail payload, reusing the last fetch while a warm
 * container is paging through it.
 */
async function loadDetails(
  activityId: string,
  maxChartSize: number,
  maxPolylineSize: number,
): Promise<ActivityDetails> {
  return withCache(`details:${activityId}:${maxChartSize}:${maxPolylineSize}`, () =>
    api.getActivityDetails(activityId, maxChartSize, maxPolylineSize),
  );
}

function resolutionNotes(details: ActivityDetails, requested: number): string[] {
  const notes: string[] = [];
  const recorded = details.measurementCount;
  const returned = (details.activityDetailMetrics ?? []).length;
  if (typeof recorded === "number" && returned < recorded) {
    notes.push(
      `Garmin returned ${returned} of ${recorded} recorded samples; raise maxChartSize ` +
        `(currently ${requested}) for the full resolution.`,
    );
  }
  return notes;
}

export function registerStreamTools(server: McpServer): void {
  server.registerTool(
    "garmin_get_activity_details",
    {
      title: "Get activity sample series",
      description:
        "Every recorded sample of an activity: heart rate, pace, cadence, power, position, " +
        "temperature — whatever the device wrote, at Garmin's stored resolution. Values are " +
        "passed through unchanged; the only transformation is naming each position from " +
        "Garmin's own metric descriptors. Page with offset/limit and narrow with `metrics`. " +
        "Call with includeSamples=false first to see which channels exist and how many samples there are.",
      inputSchema: {
        activityId: activityIdSchema,
        metrics: z
          .array(z.string())
          .optional()
          .describe("Channel keys to return, e.g. ['directTimestamp','directHeartRate']. Omit for all."),
        offset: offsetSchema,
        limit: limitSchema,
        includeSamples: z
          .boolean()
          .optional()
          .describe("Set false to return only descriptors and counts. Defaults to true."),
        format: z
          .enum(["objects", "positional"])
          .optional()
          .describe(
            "objects (default) keys each sample by channel name; positional returns Garmin's " +
              "raw arrays, to be read against `descriptors`.",
          ),
        maxChartSize: z
          .number()
          .int()
          .min(1)
          .max(MAX_CHART_SIZE)
          .optional()
          .describe(
            `Highest number of samples Garmin may return, up to ${MAX_CHART_SIZE}. ` +
              `Defaults to ${DEFAULT_CHART_SIZE}. Lower it only to trade resolution for speed.`,
          ),
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const maxChartSize = args.maxChartSize ?? DEFAULT_CHART_SIZE;
      const details = await loadDetails(activityId, maxChartSize, 0);
      const channels = availableChannels(details);

      const source = {
        endpoint: `/activity-service/activity/${activityId}/details`,
        params: { maxChartSize, maxPolylineSize: 0 },
      };
      const notes = resolutionNotes(details, maxChartSize);

      if (args.includeSamples === false) {
        return jsonResult({
          source,
          notes,
          data: {
            activityId: details.activityId ?? Number(activityId),
            sampleCount: (details.activityDetailMetrics ?? []).length,
            measurementCount: details.measurementCount ?? null,
            channels,
          },
        });
      }

      if (args.metrics?.length) {
        const known = new Set(channels.map((channel) => channel.key));
        const unknown = args.metrics.filter((metric) => !known.has(metric));
        if (unknown.length === args.metrics.length) {
          throw new ToolInputError(
            `None of the requested metrics exist on this activity. Available: ${channels
              .map((channel) => channel.key)
              .join(", ")}`,
          );
        }
        if (unknown.length > 0) {
          notes.push(`Not recorded on this activity, omitted: ${unknown.join(", ")}`);
        }
      }

      const positional = args.format === "positional";
      const samples: unknown[] = positional ? readRows(details) : decodeSamples(details, args.metrics);
      const descriptors = readDescriptors(details).filter(
        (descriptor) => !args.metrics?.length || args.metrics.includes(descriptor.key),
      );

      const fitted = paginateWithinBudget(
        samples,
        { offset: args.offset, limit: args.limit },
        getConfig().maxResponseBytes,
        2_000 + JSON.stringify(descriptors).length,
      );
      if (fitted.page.limitAdjusted) {
        notes.push("limit was reduced to fit the response budget; continue from page.nextOffset.");
      }

      return jsonResult({
        source,
        page: fitted.page,
        notes,
        data: { descriptors, format: positional ? "positional" : "objects", samples: fitted.items },
      });
    }),
  );

  server.registerTool(
    "garmin_get_heart_rate_series",
    {
      title: "Get activity heart-rate series",
      description:
        "Per-sample heart rate for one activity, paired with each sample's timestamp. A " +
        "projection of garmin_get_activity_details onto the heart-rate channel — same samples, " +
        "nothing averaged.",
      inputSchema: {
        activityId: activityIdSchema,
        offset: offsetSchema,
        limit: limitSchema,
        maxChartSize: z.number().int().min(1).max(MAX_CHART_SIZE).optional(),
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const maxChartSize = args.maxChartSize ?? DEFAULT_CHART_SIZE;
      const details = await loadDetails(activityId, maxChartSize, 0);
      const descriptors = readDescriptors(details);

      const heartRateKey = firstPresent(descriptors, HEART_RATE_KEYS);
      if (!heartRateKey) {
        throw new ToolInputError(
          `Activity ${activityId} has no heart-rate channel. Channels: ${descriptors
            .map((descriptor) => descriptor.key)
            .join(", ")}`,
        );
      }
      const timestampKey = firstPresent(descriptors, TIMESTAMP_KEYS);
      const keys = timestampKey ? [timestampKey, heartRateKey] : [heartRateKey];

      const samples = decodeSamples(details, keys);
      const notes = resolutionNotes(details, maxChartSize);
      const fitted = paginateWithinBudget(
        samples,
        { offset: args.offset, limit: args.limit },
        getConfig().maxResponseBytes,
        2_000,
      );
      if (fitted.page.limitAdjusted) {
        notes.push("limit was reduced to fit the response budget; continue from page.nextOffset.");
      }

      return jsonResult({
        source: {
          endpoint: `/activity-service/activity/${activityId}/details`,
          params: { maxChartSize, channels: keys },
        },
        page: fitted.page,
        notes,
        data: {
          heartRateKey,
          timestampKey,
          unit: descriptors.find((descriptor) => descriptor.key === heartRateKey)?.unit ?? null,
          samples: fitted.items,
        },
      });
    }),
  );

  server.registerTool(
    "garmin_get_gps_track",
    {
      title: "Get activity GPS track",
      description:
        "Position samples for one activity: latitude, longitude, elevation and timestamp per " +
        "sample. `source: 'samples'` (default) reads the recorded position channels; " +
        "`source: 'polyline'` returns Garmin's own map polyline instead. For a file, use " +
        "garmin_download_activity_file with format gpx.",
      inputSchema: {
        activityId: activityIdSchema,
        offset: offsetSchema,
        limit: limitSchema,
        source: z.enum(["samples", "polyline"]).optional(),
        includeSpeed: z
          .boolean()
          .optional()
          .describe("Also return speed and cumulative distance channels when recorded."),
        maxChartSize: z.number().int().min(1).max(MAX_CHART_SIZE).optional(),
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const usePolyline = args.source === "polyline";
      const maxChartSize = usePolyline ? 1 : args.maxChartSize ?? DEFAULT_CHART_SIZE;
      const maxPolylineSize = usePolyline ? DEFAULT_POLYLINE_SIZE : 0;
      const details = await loadDetails(activityId, maxChartSize, maxPolylineSize);
      const notes: string[] = [];

      let points: unknown[];
      let shape: Record<string, unknown>;

      if (usePolyline) {
        const polyline = details.geoPolylineDTO as { polyline?: unknown[] } | undefined;
        points = Array.isArray(polyline?.polyline) ? polyline.polyline : [];
        const { polyline: _omitted, ...metadata } = (polyline ?? {}) as Record<string, unknown>;
        shape = { polylineMetadata: metadata };
        if (points.length === 0) notes.push("Garmin returned no map polyline for this activity.");
      } else {
        const descriptors = readDescriptors(details);
        const latitudeKey = firstPresent(descriptors, LATITUDE_KEYS);
        const longitudeKey = firstPresent(descriptors, LONGITUDE_KEYS);
        if (!latitudeKey || !longitudeKey) {
          throw new ToolInputError(
            `Activity ${activityId} has no position channels — it was probably recorded indoors. ` +
              "Try source: 'polyline', or read the other channels with garmin_get_activity_details.",
          );
        }
        const keys = [latitudeKey, longitudeKey];
        const timestampKey = firstPresent(descriptors, TIMESTAMP_KEYS);
        if (timestampKey) keys.unshift(timestampKey);
        const elevationKey = firstPresent(descriptors, ELEVATION_KEYS);
        if (elevationKey) keys.push(elevationKey);
        if (args.includeSpeed) {
          for (const candidate of ["directSpeed", "sumDistance"]) {
            if (firstPresent(descriptors, [candidate])) keys.push(candidate);
          }
        }
        points = decodeSamples(details, keys);
        shape = { channels: keys };
        notes.push(...resolutionNotes(details, maxChartSize));
      }

      const fitted = paginateWithinBudget(
        points,
        { offset: args.offset, limit: args.limit },
        getConfig().maxResponseBytes,
        2_000,
      );
      if (fitted.page.limitAdjusted) {
        notes.push("limit was reduced to fit the response budget; continue from page.nextOffset.");
      }

      return jsonResult({
        source: {
          endpoint: `/activity-service/activity/${activityId}/details`,
          params: { maxChartSize, maxPolylineSize, source: args.source ?? "samples" },
        },
        page: fitted.page,
        notes,
        data: { ...shape, points: fitted.items },
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity_splits",
    {
      title: "Get activity splits",
      description:
        "Laps and splits for one activity. `kind: 'splits'` gives per-lap records, " +
        "'typedsplits' the sport-specific breakdown (climbs, sets), 'split_summaries' " +
        "Garmin's grouped summaries. Returned as stored.",
      inputSchema: {
        activityId: activityIdSchema,
        kind: z.enum(["splits", "typedsplits", "split_summaries"]).optional(),
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const kind = args.kind ?? "splits";
      return jsonResult({
        source: { endpoint: `/activity-service/activity/${activityId}/${kind}` },
        data: await api.getActivitySplits(activityId, kind),
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity_hr_zones",
    {
      title: "Get activity heart-rate zones",
      description: "Time spent in each heart-rate zone during one activity, as Garmin computed it.",
      inputSchema: { activityId: activityIdSchema },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      return jsonResult({
        source: { endpoint: `/activity-service/activity/${activityId}/hrTimeInZones` },
        data: await api.getActivityHrZones(activityId),
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity_weather",
    {
      title: "Get activity weather",
      description: "Weather conditions Garmin recorded for one activity.",
      inputSchema: { activityId: activityIdSchema },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      return jsonResult({
        source: { endpoint: `/activity-service/activity/${activityId}/weather` },
        data: await api.getActivityWeather(activityId),
      });
    }),
  );

  server.registerTool(
    "garmin_get_activity_exercise_sets",
    {
      title: "Get strength-training sets",
      description: "Per-set detail for strength and HIIT activities: exercise, reps, weight, duration.",
      inputSchema: { activityId: activityIdSchema },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      return jsonResult({
        source: { endpoint: `/activity-service/activity/${activityId}/exerciseSets` },
        data: await api.getActivityExerciseSets(activityId),
      });
    }),
  );
}
