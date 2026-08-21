/**
 * Turns the long-lived OAuth1 token in `GARMIN_TOKEN` into a short-lived OAuth2
 * bearer token for the Connect API.
 *
 * The OAuth2 token is cached in module scope, so warm serverless invocations
 * reuse it and only pay for the exchange once per hour. Nothing is written to
 * disk: the process memory is the only place a live access token exists.
 */

import { getConfig } from "../config.js";
import { GarminAuthError, GarminHttpError } from "../errors.js";
import { buildAuthorizationHeader } from "./oauth1.js";
import {
  isExpired,
  parseTokenBlob,
  withExpiry,
  type GarminTokens,
  type OAuth2Token,
} from "./tokens.js";

const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
const OAUTH_USER_AGENT = "com.garmin.android.apps.connectmobile";
const CONSUMER_TTL_MS = 24 * 60 * 60 * 1000;

interface Consumer {
  consumer_key: string;
  consumer_secret: string;
}

let consumerCache: { value: Consumer; fetchedAt: number } | null = null;
let tokensCache: GarminTokens | null = null;
let accessTokenCache: OAuth2Token | null = null;
let inFlight: Promise<OAuth2Token> | null = null;

/**
 * The OAuth1 consumer key/secret shipped with the Garmin mobile app.
 *
 * Garmin rotates these, so they are fetched at runtime and cached. Pin them with
 * `GARMIN_OAUTH_CONSUMER` to avoid the network hop or the external dependency.
 */
async function getConsumer(explicit?: Consumer): Promise<Consumer> {
  // The login script passes its own, so it can run before the server's
  // environment variables exist.
  const configured = explicit ?? getConfig().oauthConsumer;
  if (configured) return configured;

  if (consumerCache && Date.now() - consumerCache.fetchedAt < CONSUMER_TTL_MS) {
    return consumerCache.value;
  }

  const response = await fetch(OAUTH_CONSUMER_URL, {
    headers: { "User-Agent": OAUTH_USER_AGENT },
  });
  if (!response.ok) {
    throw new GarminAuthError(
      `Could not fetch OAuth consumer credentials (HTTP ${response.status}). ` +
        "Set GARMIN_OAUTH_CONSUMER to pin them instead.",
    );
  }
  const body = (await response.json()) as Partial<Consumer>;
  if (!body.consumer_key || !body.consumer_secret) {
    throw new GarminAuthError("OAuth consumer document is missing key or secret.");
  }
  const value: Consumer = {
    consumer_key: body.consumer_key,
    consumer_secret: body.consumer_secret,
  };
  consumerCache = { value, fetchedAt: Date.now() };
  return value;
}

function loadTokens(): GarminTokens {
  if (!tokensCache) {
    tokensCache = parseTokenBlob(getConfig().garminToken);
  }
  return tokensCache;
}

/** Garmin's API host for this account's region. */
export function connectApiOrigin(): string {
  const domain = loadTokens().oauth1.domain || getConfig().garminDomain;
  return `https://connectapi.${domain}`;
}

/**
 * Exchanges the OAuth1 token for a fresh OAuth2 access token.
 *
 * Exported so the login script can mint the first pair with the same code path
 * the server uses to refresh it.
 */
export async function exchangeForAccessToken(
  tokens: GarminTokens,
  options: {
    domain: string;
    login?: boolean;
    timeoutMs?: number;
    consumer?: { consumer_key: string; consumer_secret: string };
  } = { domain: "garmin.com" },
): Promise<OAuth2Token> {
  const consumer = await getConsumer(options.consumer);
  const url = `https://connectapi.${options.domain}/oauth-service/oauth/exchange/user/2.0`;

  const formParams: Record<string, string> = {};
  if (options.login) formParams["audience"] = "GARMIN_CONNECT_MOBILE_ANDROID_DI";
  if (tokens.oauth1.mfa_token) formParams["mfa_token"] = tokens.oauth1.mfa_token;

  const authorization = buildAuthorizationHeader(
    {
      consumerKey: consumer.consumer_key,
      consumerSecret: consumer.consumer_secret,
      token: tokens.oauth1.oauth_token,
      tokenSecret: tokens.oauth1.oauth_token_secret,
    },
    { method: "POST", url, formParams },
  );

  const timeoutMs = options.timeoutMs ?? 20_000;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": OAUTH_USER_AGENT,
    },
    body: new URLSearchParams(formParams).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new GarminAuthError(
        `Garmin rejected the stored OAuth1 token (HTTP ${response.status}). ` +
          "It has expired or been revoked — re-run `npm run login` and update GARMIN_TOKEN.",
      );
    }
    throw new GarminHttpError(response.status, "/oauth-service/oauth/exchange/user/2.0", body);
  }

  return withExpiry((await response.json()) as Record<string, unknown>);
}

/**
 * A valid bearer token, refreshing it if the cached one is expired or missing.
 *
 * Concurrent callers share one in-flight exchange so a burst of tool calls on a
 * cold start does not fire several exchanges at once.
 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  const tokens = loadTokens();

  if (!forceRefresh) {
    const candidate = accessTokenCache ?? tokens.oauth2;
    if (candidate && !isExpired(candidate)) {
      accessTokenCache = candidate;
      return candidate.access_token;
    }
  }

  if (!inFlight) {
    const config = getConfig();
    inFlight = exchangeForAccessToken(tokens, {
      domain: tokens.oauth1.domain || config.garminDomain,
      timeoutMs: config.requestTimeoutMs,
    })
      .then((token) => {
        accessTokenCache = token;
        return token;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  const token = await inFlight;
  return token.access_token;
}

/** Test hook: forget every cached credential. */
export function resetAuthCache(): void {
  consumerCache = null;
  tokensCache = null;
  accessTokenCache = null;
  inFlight = null;
}
