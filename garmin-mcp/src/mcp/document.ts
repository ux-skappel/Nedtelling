/**
 * Navigating Garmin's daily wellness documents.
 *
 * A day of sleep comes back as one object holding a summary plus eight or nine
 * parallel sample series (levels, movement, heart rate, respiration, SpO2,
 * stress, body battery, HRV). Pulling the whole document into a conversation to
 * read one series is wasteful, so tools return the summary with an index of the
 * series it contains, and page each series on request.
 */

export interface SeriesIndexEntry {
  key: string;
  length: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Names and lengths of the top-level arrays in a document. */
export function indexSeries(document: unknown): SeriesIndexEntry[] {
  if (Array.isArray(document)) return [{ key: "(root)", length: document.length }];
  if (!isPlainObject(document)) return [];
  return Object.entries(document)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => ({ key, length: (value as unknown[]).length }));
}

/** The document with its sample series replaced by their lengths. */
export function summarize(document: unknown): unknown {
  if (Array.isArray(document)) return { itemCount: document.length };
  if (!isPlainObject(document)) return document;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    summary[key] = Array.isArray(value) ? { seriesLength: value.length } : value;
  }
  return summary;
}

export interface ResolvedSeries {
  key: string;
  items: unknown[];
}

/**
 * Finds a named series, accepting a friendly alias, Garmin's own key, or
 * `(root)` when the document is itself an array.
 */
export function resolveSeries(
  document: unknown,
  name: string,
  aliases: Record<string, string>,
): ResolvedSeries | null {
  if (Array.isArray(document)) {
    // A root array has one series; aliases like { days: "(root)" } point at it.
    const target = aliases[name] ?? name;
    return target === "(root)" || target === "all"
      ? { key: "(root)", items: document }
      : null;
  }
  if (!isPlainObject(document)) return null;

  const candidates = [aliases[name], name].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const value = document[candidate];
    if (Array.isArray(value)) return { key: candidate, items: value };
  }

  // Last resort: case-insensitive match, since Garmin mixes SPO2 and Spo2.
  const lowered = name.toLowerCase();
  for (const [key, value] of Object.entries(document)) {
    if (Array.isArray(value) && key.toLowerCase() === lowered) return { key, items: value };
  }
  return null;
}
