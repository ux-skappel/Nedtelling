/** Zod fragments shared by the tool definitions, plus the checks Zod can't do. */

import { z } from "zod";
import { ToolInputError } from "../errors.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./paging.js";

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date in YYYY-MM-DD form.");

export const activityIdSchema = z
  .union([z.string(), z.number()])
  .describe("Garmin activity id, as returned by garmin_list_activities.");

export const offsetSchema = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Index of the first sample to return. Defaults to 0.");

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(
    `How many samples to return, at most ${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}. ` +
      "Reduced automatically if the page would exceed the response byte budget.",
  );

/** Garmin ids are positive integers; anything else is a client mistake. */
export function parseActivityId(value: string | number): string {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new ToolInputError(`activityId must be a positive integer, got ${JSON.stringify(value)}.`);
  }
  return text;
}

export function assertDateOrder(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new ToolInputError(`startDate ${startDate} is after endDate ${endDate}.`);
  }
}

/** Rejects ranges wide enough that Garmin would either truncate or time out. */
export function assertRangeWithin(startDate: string, endDate: string, maxDays: number): void {
  assertDateOrder(startDate, endDate);
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  if (days + 1 > maxDays) {
    throw new ToolInputError(
      `Range ${startDate}..${endDate} spans ${days + 1} days; this endpoint accepts at most ${maxDays}. ` +
        "Split it into several calls.",
    );
  }
}
