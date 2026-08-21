/** Shared shape for every tool result, and the error boundary around handlers. */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getConfig } from "../config.js";
import { GarminAuthError, GarminHttpError, ToolInputError, describeError } from "../errors.js";
import type { PageInfo } from "./paging.js";

export interface ToolPayload {
  /** Which Garmin endpoint produced this, so a reader can verify provenance. */
  source: { endpoint: string; params?: Record<string, unknown> };
  page?: PageInfo;
  /** Anything the tool wants to say about the shape of `data`. */
  notes?: string[];
  data: unknown;
}

/** The MCP SDK's tool-result shape; every handler returns one text block of JSON. */
export type ToolResult = CallToolResult;

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function jsonResult(payload: ToolPayload): ToolResult {
  const serialized = JSON.stringify(payload);
  const budget = getConfig().maxResponseBytes;

  // Paged tools stay inside the budget on their own; this catches the rest —
  // a single oversized document is better refused than silently truncated.
  if (Buffer.byteLength(serialized, "utf8") > budget) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "response_too_large",
            message:
              `The response from ${payload.source.endpoint} is larger than the ` +
              `${budget} byte budget. Request a narrower window (smaller limit, ` +
              "fewer metrics, or a shorter date range), or raise MCP_MAX_RESPONSE_BYTES.",
            source: payload.source,
          }),
        },
      ],
    };
  }

  return text(serialized);
}

export function errorResult(error: unknown): ToolResult {
  let code = "garmin_error";
  if (error instanceof ToolInputError) code = "invalid_input";
  else if (error instanceof GarminAuthError) code = "auth_error";
  else if (error instanceof GarminHttpError) {
    code = error.status === 404 ? "not_found" : `http_${error.status}`;
  } else if (error instanceof Error && error.name === "TimeoutError") code = "timeout";

  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: code, message: describeError(error) }) }],
  };
}

/** Wraps a tool handler so a thrown error becomes a readable tool result. */
export function guarded<Args>(
  handler: (args: Args) => Promise<ToolResult>,
): (args: Args) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}
