/**
 * Thin HTTP client for `connectapi.garmin.com`.
 *
 * Responsibilities stop at transport: attach the bearer token, retry the
 * failures worth retrying, and hand back whatever Garmin sent. Nothing here
 * reshapes payloads — the tools decide how to slice them.
 */

import { getConfig } from "../config.js";
import { GarminHttpError } from "../errors.js";
import { connectApiOrigin, getAccessToken } from "./auth.js";

const USER_AGENT = "GCM-iOS-5.22.1.4";
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  params?: QueryParams;
  /** Extra headers, e.g. a non-JSON `Accept` for file downloads. */
  headers?: Record<string, string>;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  body: ArrayBuffer;
}

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, connectApiOrigin());
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function retryDelayMs(attempt: number, response?: Response): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 10_000);
    }
  }
  const base = 500 * 2 ** attempt;
  return base + Math.floor(Math.random() * 250);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Performs an authenticated GET, retrying transient failures and refreshing the
 * access token once if Garmin says it is no longer good.
 */
export async function requestRaw(path: string, options: RequestOptions = {}): Promise<RawResponse> {
  const config = getConfig();
  const url = buildUrl(path, options.params);
  let refreshed = false;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await getAccessToken(refreshed)}`,
          "User-Agent": USER_AGENT,
          Accept: "application/json, */*",
          ...options.headers,
        },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      // Network error or timeout: worth one more try, then give up.
      lastError = error;
      if (attempt === MAX_ATTEMPTS - 1) throw error;
      await sleep(retryDelayMs(attempt));
      continue;
    }

    // A rejected bearer token is worth exactly one retry with a fresh one; on
    // the last attempt fall through so the caller sees the real status.
    if (
      (response.status === 401 || response.status === 403) &&
      !refreshed &&
      attempt < MAX_ATTEMPTS - 1
    ) {
      refreshed = true;
      await response.body?.cancel();
      continue;
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
      await response.body?.cancel();
      await sleep(retryDelayMs(attempt, response));
      continue;
    }

    if (!response.ok) {
      throw new GarminHttpError(response.status, path, await response.text().catch(() => ""));
    }

    return {
      status: response.status,
      headers: response.headers,
      body: await response.arrayBuffer(),
    };
  }

  throw lastError instanceof Error ? lastError : new Error(`Request to ${path} failed`);
}

/** GET a JSON endpoint. Returns `null` for Garmin's empty `204` responses. */
export async function connectApi<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T | null> {
  const response = await requestRaw(path, options);
  if (response.status === 204 || response.body.byteLength === 0) return null;

  const text = new TextDecoder().decode(response.body);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GarminHttpError(response.status, path, `Expected JSON, got: ${text.slice(0, 500)}`);
  }
}

/** GET a file endpoint (GPX/TCX/KML/CSV/FIT) as bytes. */
export async function download(path: string, options: RequestOptions = {}): Promise<RawResponse> {
  return requestRaw(path, { ...options, headers: { Accept: "*/*", ...options.headers } });
}
