/**
 * Parsing and serialization of the Garmin token blob held in `GARMIN_TOKEN`.
 *
 * The wire format is intentionally the same one `garth` uses (base64 of a JSON
 * `[oauth1, oauth2]` pair), so a token minted by either this project's login
 * script or by `garth` can be pasted into the same environment variable.
 */

import { GarminAuthError } from "../errors.js";

export interface OAuth1Token {
  oauth_token: string;
  oauth_token_secret: string;
  mfa_token?: string | null;
  mfa_expiration_timestamp?: string | null;
  domain?: string | null;
}

export interface OAuth2Token {
  scope: string;
  jti: string;
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** Absolute expiry, in seconds since the epoch. */
  expires_at: number;
  refresh_token_expires_in: number;
  refresh_token_expires_at: number;
}

export interface GarminTokens {
  oauth1: OAuth1Token;
  oauth2: OAuth2Token | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOAuth1(value: unknown): OAuth1Token {
  if (
    !isRecord(value) ||
    typeof value["oauth_token"] !== "string" ||
    typeof value["oauth_token_secret"] !== "string"
  ) {
    throw new GarminAuthError(
      "GARMIN_TOKEN does not contain an OAuth1 token pair. Re-run `npm run login`.",
    );
  }
  const token: OAuth1Token = {
    oauth_token: value["oauth_token"],
    oauth_token_secret: value["oauth_token_secret"],
  };
  if (typeof value["mfa_token"] === "string") token.mfa_token = value["mfa_token"];
  if (typeof value["domain"] === "string") token.domain = value["domain"];
  return token;
}

function asOAuth2(value: unknown): OAuth2Token | null {
  if (!isRecord(value)) return null;
  if (typeof value["access_token"] !== "string" || typeof value["expires_at"] !== "number") {
    return null;
  }
  return value as unknown as OAuth2Token;
}

/** Accepts base64-wrapped or bare JSON, and either the pair form or OAuth1 alone. */
export function parseTokenBlob(blob: string): GarminTokens {
  const trimmed = blob.trim();
  let text = trimmed;
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    try {
      text = Buffer.from(trimmed, "base64").toString("utf8");
    } catch {
      throw new GarminAuthError("GARMIN_TOKEN is neither JSON nor valid base64.");
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GarminAuthError("GARMIN_TOKEN did not decode to JSON. Re-run `npm run login`.");
  }

  if (Array.isArray(parsed)) {
    return { oauth1: asOAuth1(parsed[0]), oauth2: asOAuth2(parsed[1]) };
  }
  return { oauth1: asOAuth1(parsed), oauth2: null };
}

/** Inverse of {@link parseTokenBlob}; used by the login script. */
export function serializeTokens(tokens: GarminTokens): string {
  const payload = JSON.stringify([tokens.oauth1, tokens.oauth2]);
  return Buffer.from(payload, "utf8").toString("base64");
}

/** Adds `expires_at` / `refresh_token_expires_at` to a freshly issued OAuth2 token. */
export function withExpiry(raw: Record<string, unknown>, now = Date.now()): OAuth2Token {
  const seconds = Math.floor(now / 1000);
  const expiresIn = typeof raw["expires_in"] === "number" ? raw["expires_in"] : 0;
  const refreshExpiresIn =
    typeof raw["refresh_token_expires_in"] === "number" ? raw["refresh_token_expires_in"] : 0;
  return {
    ...(raw as unknown as OAuth2Token),
    expires_at: seconds + expiresIn,
    refresh_token_expires_at: seconds + refreshExpiresIn,
  };
}

export function isExpired(token: OAuth2Token, skewSeconds = 60, now = Date.now()): boolean {
  return token.expires_at - skewSeconds <= Math.floor(now / 1000);
}
