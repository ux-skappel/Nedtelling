/**
 * Cursor-free paging over arrays that Garmin returns whole.
 *
 * Garmin has no server-side paging for sample series — one request yields the
 * entire day or activity. Slicing therefore happens here: the caller asks for a
 * window, gets exactly that window plus the offset to continue from, and never
 * has to pull a 40 000-sample array into the conversation to read the first
 * minute of it.
 */

export interface PageRequest {
  offset?: number | undefined;
  limit?: number | undefined;
}

export interface PageInfo {
  offset: number;
  limit: number;
  /** How many items this response actually carries. */
  returned: number;
  /** Length of the underlying series, or null when the server pages for us. */
  total: number | null;
  nextOffset: number | null;
  hasMore: boolean;
  /** Set when `limit` was reduced to keep the response inside the byte budget. */
  limitAdjusted?: boolean;
}

export interface Page<T> {
  items: T[];
  page: PageInfo;
}

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 100_000;

function normalize(request: PageRequest, total: number): { offset: number; limit: number } {
  const offset = Math.min(Math.max(Math.trunc(request.offset ?? 0), 0), Math.max(total, 0));
  const limit = Math.min(Math.max(Math.trunc(request.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  return { offset, limit };
}

export function paginate<T>(items: readonly T[], request: PageRequest = {}): Page<T> {
  const total = items.length;
  const { offset, limit } = normalize(request, total);
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  return {
    items: slice,
    page: {
      offset,
      limit,
      returned: slice.length,
      total,
      nextOffset: end < total ? end : null,
      hasMore: end < total,
    },
  };
}

/**
 * Pages a series, then shrinks the window until the serialized payload fits
 * `budgetBytes`.
 *
 * A caller that asks for 50 000 samples gets as many as fit and an honest
 * `nextOffset`, instead of a response the client has to reject.
 */
export function paginateWithinBudget<T>(
  items: readonly T[],
  request: PageRequest,
  budgetBytes: number,
  /** Bytes already spoken for by the envelope around the items. */
  overheadBytes = 0,
): Page<T> {
  let result = paginate(items, request);
  const available = Math.max(budgetBytes - overheadBytes, 1_000);

  let adjusted = false;
  // Each pass estimates from the measured average item size, so this converges
  // in two or three rounds even for wildly uneven samples.
  for (let round = 0; round < 5; round += 1) {
    const size = Buffer.byteLength(JSON.stringify(result.items), "utf8");
    if (size <= available || result.items.length <= 1) break;
    const perItem = size / result.items.length;
    const fitting = Math.max(1, Math.floor(available / perItem));
    if (fitting >= result.items.length) break;
    adjusted = true;
    result = paginate(items, { offset: result.page.offset, limit: fitting });
  }

  if (adjusted) {
    result.page.limitAdjusted = true;
  }
  return result;
}
