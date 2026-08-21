/**
 * Runtime configuration, read once per cold start.
 *
 * Every secret lives in a Vercel environment variable; nothing is persisted to
 * disk or to a database. See docs/SETUP.md for how each value is minted.
 */

export interface Config {
  /** Garmin Connect domain: `garmin.com`, or `garmin.cn` for China accounts. */
  garminDomain: string;
  /** Serialized Garmin token blob (base64 JSON), from `npm run login`. */
  garminToken: string;
  /** Shared secret every MCP client must present as `Authorization: Bearer`. */
  mcpAuthToken: string;
  /** Optional pinned OAuth1 consumer credentials, as JSON. */
  oauthConsumer: { consumer_key: string; consumer_secret: string } | null;
  /** Per-request timeout against Garmin, in milliseconds. */
  requestTimeoutMs: number;
  /** Soft cap on the JSON payload of a single tool result, in bytes. */
  maxResponseBytes: number;
}

export class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(
      `Missing required environment variable ${name}. See docs/SETUP.md.`,
    );
  }
  return value;
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`${name} must be an integer, got ${JSON.stringify(raw)}.`);
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseConsumer(): Config["oauthConsumer"] {
  const raw = process.env["GARMIN_OAUTH_CONSUMER"];
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(
      "GARMIN_OAUTH_CONSUMER must be JSON of the form " +
        '{"consumer_key":"...","consumer_secret":"..."}.',
    );
  }
  const consumer = parsed as Record<string, unknown>;
  if (typeof consumer["consumer_key"] !== "string" || typeof consumer["consumer_secret"] !== "string") {
    throw new ConfigError("GARMIN_OAUTH_CONSUMER needs both consumer_key and consumer_secret.");
  }
  return {
    consumer_key: consumer["consumer_key"],
    consumer_secret: consumer["consumer_secret"],
  };
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  cached = {
    garminDomain: process.env["GARMIN_DOMAIN"] || "garmin.com",
    garminToken: required("GARMIN_TOKEN"),
    mcpAuthToken: required("MCP_AUTH_TOKEN"),
    oauthConsumer: parseConsumer(),
    requestTimeoutMs: intFromEnv("GARMIN_REQUEST_TIMEOUT_MS", 20_000, 1_000, 55_000),
    maxResponseBytes: intFromEnv("MCP_MAX_RESPONSE_BYTES", 350_000, 10_000, 5_000_000),
  };
  return cached;
}

/** Test hook: drop the memoized config so the next read sees fresh env vars. */
export function resetConfig(): void {
  cached = null;
}
