/**
 * An escape hatch onto the rest of the Connect API.
 *
 * Garmin exposes far more endpoints than this server wraps, and adds new ones
 * without notice. This tool reaches any read-only Connect API path so a new
 * metric does not require a redeploy — bounded to GET, to Garmin's own host, and
 * to paths that look like Connect API services.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "../../config.js";
import { connectApi } from "../../garmin/client.js";
import { ToolInputError } from "../../errors.js";
import { indexSeries, resolveSeries, summarize } from "../document.js";
import { paginateWithinBudget } from "../paging.js";
import { guarded, jsonResult } from "../result.js";
import { limitSchema, offsetSchema } from "../schema.js";

/** Connect API paths all sit under a `*-service` or `*-gateway` prefix. */
const ALLOWED_PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*-(?:service|gateway)\/[A-Za-z0-9._\-/]*$/;

export function validatePath(input: string): string {
  const path = input.startsWith("/") ? input : `/${input}`;
  if (path.includes("..") || path.includes("//")) {
    throw new ToolInputError("path must not contain '..' or '//'.");
  }
  if (path.includes("?")) {
    throw new ToolInputError("Put query parameters in `params`, not in `path`.");
  }
  if (!ALLOWED_PATH.test(path)) {
    throw new ToolInputError(
      `path must be a Connect API service path, e.g. /metrics-service/metrics/hillscore/2026-08-01. Got ${path}.`,
    );
  }
  return path;
}

export function registerRawTools(server: McpServer): void {
  server.registerTool(
    "garmin_get_raw",
    {
      title: "Call a Connect API endpoint",
      description:
        "GET any read-only Garmin Connect API path and return the response untouched. Use this " +
        "for metrics the dedicated tools do not cover. Paths must look like " +
        "/<name>-service/... or /<name>-gateway/...; anything else is refused. Long arrays can be " +
        "paged with `series`, `offset` and `limit`, the same way the wellness tools work.",
      inputSchema: {
        path: z
          .string()
          .describe("Connect API path, e.g. /metrics-service/metrics/maxmet/daily/2026-08-01."),
        params: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters."),
        series: z.string().optional().describe("Name of an array in the response to page through."),
        offset: offsetSchema,
        limit: limitSchema,
      },
    },
    guarded(async (args) => {
      const path = validatePath(args.path);
      const document = await connectApi(path, { params: args.params ?? {} });
      const source = { endpoint: path, params: args.params ?? {} };

      if (!args.series) {
        const available = indexSeries(document);
        const serialized = Buffer.byteLength(JSON.stringify(document ?? null), "utf8");
        // Small responses come back whole; large ones get the summary treatment.
        if (serialized <= getConfig().maxResponseBytes / 2) {
          return jsonResult({ source, data: document });
        }
        return jsonResult({
          source,
          notes: [
            "Response was large, so arrays were replaced by their lengths. Call again with " +
              `series set to one of: ${available.map((entry) => entry.key).join(", ") || "(none)"}.`,
          ],
          data: { summary: summarize(document), series: available },
        });
      }

      const resolved = resolveSeries(document, args.series, {});
      if (!resolved) {
        throw new ToolInputError(
          `No array named ${JSON.stringify(args.series)} in the response. Available: ` +
            `${indexSeries(document).map((entry) => entry.key).join(", ") || "(none)"}.`,
        );
      }
      const fitted = paginateWithinBudget(
        resolved.items,
        { offset: args.offset, limit: args.limit },
        getConfig().maxResponseBytes,
        2_000,
      );
      return jsonResult({
        source: { ...source, params: { ...source.params, series: resolved.key } },
        page: fitted.page,
        data: { series: resolved.key, samples: fitted.items },
      });
    }),
  );
}
