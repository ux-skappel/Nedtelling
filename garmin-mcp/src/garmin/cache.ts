/**
 * A small in-process cache for payloads that get paged over.
 *
 * There is no database in this project by design, but paging through a 30 000
 * sample activity would otherwise re-download the whole activity for every page.
 * Keeping the last few responses in the lambda's memory makes paging cheap while
 * a container stays warm, and costs nothing but a re-fetch when it doesn't.
 *
 * Deliberately modest: a handful of entries, a short TTL, no persistence, and no
 * sharing between instances.
 */

const MAX_ENTRIES = 8;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

function evictExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

/** Returns the cached value for `key`, or awaits `load` and caches the result. */
export async function withCache<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now) {
    // Refresh insertion order so hot entries survive eviction.
    entries.delete(key);
    entries.set(key, hit);
    return hit.value as T;
  }

  const value = await load();
  evictExpired(now);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function clearCache(): void {
  entries.clear();
}
