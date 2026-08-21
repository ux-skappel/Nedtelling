/**
 * Decoding of Garmin's positional sample format.
 *
 * `/activity/{id}/details` returns samples as bare arrays plus a descriptor list
 * mapping each array position to a channel name (`directHeartRate`,
 * `directLatitude`, …). The mapping varies by device and activity type, so it
 * has to be read per activity. Decoding renames values; it never combines,
 * resamples, or drops them.
 */

import type { ActivityDetails } from "../garmin/endpoints.js";

export type Sample = Record<string, number | null>;

export interface Descriptor {
  key: string;
  index: number;
  unit: string | null;
}

/** Channel descriptors in the order Garmin reported them, invalid ones dropped. */
export function readDescriptors(details: ActivityDetails): Descriptor[] {
  const descriptors: Descriptor[] = [];
  for (const raw of details.metricDescriptors ?? []) {
    const key = raw?.key;
    const index = raw?.metricsIndex;
    if (typeof key !== "string") continue;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) continue;
    const unit = raw.unit as { key?: unknown } | undefined;
    descriptors.push({
      key,
      index,
      unit: typeof unit?.key === "string" ? unit.key : null,
    });
  }
  return descriptors;
}

/** The raw positional rows, untouched. */
export function readRows(details: ActivityDetails): Array<Array<number | null>> {
  return (details.activityDetailMetrics ?? []).map((sample) => sample?.metrics ?? []);
}

/**
 * Turns positional rows into `{ channelName: value }` objects.
 *
 * `keys`, when given, restricts the output to those channels — the cheapest way
 * to pull one series (heart rate, say) out of a twenty-channel activity.
 */
export function decodeSamples(details: ActivityDetails, keys?: readonly string[]): Sample[] {
  const wanted = keys && keys.length > 0 ? new Set(keys) : null;
  const descriptors = readDescriptors(details).filter((d) => !wanted || wanted.has(d.key));
  return readRows(details).map((row) => {
    const sample: Sample = {};
    for (const descriptor of descriptors) {
      if (descriptor.index < row.length) {
        sample[descriptor.key] = row[descriptor.index] ?? null;
      }
    }
    return sample;
  });
}

/** Channel names present on this activity — useful before asking for a subset. */
export function availableChannels(details: ActivityDetails): Array<{ key: string; unit: string | null }> {
  return readDescriptors(details).map(({ key, unit }) => ({ key, unit }));
}

/**
 * Picks the first channel present from a list of candidates.
 *
 * Garmin names the same physical quantity differently across sports (elevation
 * is `directElevation` on a run and `directGpsElevation` on some devices), so
 * tools that want a specific series ask for all the spellings they know.
 */
export function firstPresent(
  descriptors: readonly Descriptor[],
  candidates: readonly string[],
): string | null {
  const present = new Set(descriptors.map((d) => d.key));
  return candidates.find((candidate) => present.has(candidate)) ?? null;
}
