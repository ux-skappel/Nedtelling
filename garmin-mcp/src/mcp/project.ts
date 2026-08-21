/**
 * Field projection.
 *
 * Garmin's activity summaries carry ~90 top-level fields. Letting a caller name
 * the ones it wants keeps a 50-activity listing small without hiding anything:
 * the projection is opt-in, and omitting `fields` returns every field.
 */

export function pickFields<T extends Record<string, unknown>>(
  record: T,
  fields: readonly string[] | undefined,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return record;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in record) picked[field] = record[field];
  }
  return picked;
}

export function projectAll(
  records: readonly unknown[],
  fields: readonly string[] | undefined,
): unknown[] {
  if (!fields || fields.length === 0) return [...records];
  return records.map((record) =>
    record && typeof record === "object" && !Array.isArray(record)
      ? pickFields(record as Record<string, unknown>, fields)
      : record,
  );
}
