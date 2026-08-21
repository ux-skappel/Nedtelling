/** Download an activity as a file: GPX, TCX, KML, CSV, or the original FIT. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfig } from "../../config.js";
import { withCache } from "../../garmin/cache.js";
import * as api from "../../garmin/endpoints.js";
import type { DownloadFormat } from "../../garmin/endpoints.js";
import { guarded, jsonResult } from "../result.js";
import { activityIdSchema, parseActivityId } from "../schema.js";
import type { PageInfo } from "../paging.js";

const TEXT_FORMATS = new Set<DownloadFormat>(["gpx", "tcx", "kml", "csv"]);

/**
 * Length of `slice` with any trailing partial UTF-8 sequence removed.
 *
 * Byte ranges are the only honest way to page a file, but cutting a multi-byte
 * character in half would corrupt both pages. Ending the page early instead
 * keeps every page valid text and lets the next one resume at the boundary.
 */
function utf8SafeLength(slice: Buffer): number {
  const start = Math.max(0, slice.byteLength - 4);
  for (let index = slice.byteLength - 1; index >= start; index -= 1) {
    const byte = slice[index] as number;
    if ((byte & 0xc0) === 0x80) continue; // continuation byte — keep walking back
    const sequenceLength =
      byte < 0x80 ? 1 : (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : (byte & 0xf8) === 0xf0 ? 4 : 1;
    return index + sequenceLength <= slice.byteLength ? slice.byteLength : index;
  }
  return slice.byteLength;
}

async function loadFile(activityId: string, format: DownloadFormat): Promise<Buffer> {
  return withCache(`file:${activityId}:${format}`, async () => {
    const response = await api.downloadActivityFile(activityId, format);
    return Buffer.from(response.body);
  });
}

export function registerFileTools(server: McpServer): void {
  server.registerTool(
    "garmin_download_activity_file",
    {
      title: "Download activity file",
      description:
        "The activity as a file, byte for byte: gpx, tcx, kml or csv as text, or `original` " +
        "as the base64 of the FIT zip Garmin stores. Large files are returned in byte ranges — " +
        "continue from page.nextOffset until hasMore is false.",
      inputSchema: {
        activityId: activityIdSchema,
        format: z
          .enum(["gpx", "tcx", "kml", "csv", "original"])
          .optional()
          .describe("Defaults to gpx. `original` is the uploaded FIT file, zipped."),
        offset: z.number().int().min(0).optional().describe("Byte offset to start at. Defaults to 0."),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("How many bytes to return. Defaults to whatever fits the response budget."),
      },
    },
    guarded(async (args) => {
      const activityId = parseActivityId(args.activityId);
      const format = (args.format ?? "gpx") as DownloadFormat;
      const buffer = await loadFile(activityId, format);
      const isText = TEXT_FORMATS.has(format);

      // base64 costs four bytes of payload for every three bytes of file.
      const budget = Math.max(getConfig().maxResponseBytes - 2_000, 1_000);
      const maxBytes = isText ? budget : Math.floor((budget * 3) / 4);

      const offset = Math.min(args.offset ?? 0, buffer.byteLength);
      const limit = Math.min(args.limit ?? maxBytes, maxBytes);
      let slice = buffer.subarray(offset, offset + limit);
      if (isText && offset + slice.byteLength < buffer.byteLength) {
        slice = slice.subarray(0, utf8SafeLength(slice));
      }
      const end = offset + slice.byteLength;

      const page: PageInfo = {
        offset,
        limit,
        returned: slice.byteLength,
        total: buffer.byteLength,
        nextOffset: end < buffer.byteLength ? end : null,
        hasMore: end < buffer.byteLength,
        ...(args.limit && args.limit > maxBytes ? { limitAdjusted: true } : {}),
      };

      const notes: string[] = [];
      if (page.hasMore) {
        notes.push(
          `Partial file: bytes ${offset}–${end} of ${buffer.byteLength}. Call again with offset ${end}.`,
        );
      }
      if (!isText) {
        notes.push("`content` is base64; concatenate the pages before decoding.");
      }

      return jsonResult({
        source: {
          endpoint: `/download-service/${format === "original" ? "files" : `export/${format}`}/activity/${activityId}`,
          params: { format },
        },
        page,
        notes,
        data: {
          format,
          encoding: isText ? "text" : "base64",
          byteLength: buffer.byteLength,
          content: isText ? slice.toString("utf8") : slice.toString("base64"),
        },
      });
    }),
  );
}
