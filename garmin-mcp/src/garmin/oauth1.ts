/**
 * Minimal OAuth 1.0a (HMAC-SHA1) request signing.
 *
 * Garmin's mobile API mints short-lived OAuth2 access tokens from a long-lived
 * OAuth1 token pair, and the exchange call must be OAuth1-signed. That is the
 * only place we need OAuth1 — everything after it is a plain bearer token.
 */

import { createHmac, randomBytes } from "node:crypto";

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
}

export interface SignOptions {
  method: string;
  /** Full URL; its query string is folded into the signature base string. */
  url: string;
  /** `application/x-www-form-urlencoded` body parameters, if any. */
  formParams?: Record<string, string>;
  /** Overrides for nonce/timestamp; only tests should set these. */
  nonce?: string;
  timestamp?: number;
}

/** RFC 3986 percent-encoding — stricter than `encodeURIComponent`. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The normalized parameter string from RFC 5849 §3.4.1.3.2: every parameter
 * percent-encoded, then sorted by encoded name and, for repeats, by value.
 */
export function normalizeParams(params: Array<[string, string]>): string {
  return params
    .map(([key, value]): [string, string] => [percentEncode(key), percentEncode(value)])
    .sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? (valueA < valueB ? -1 : valueA > valueB ? 1 : 0) : keyA < keyB ? -1 : 1,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/**
 * Builds the `Authorization: OAuth ...` header value for a request.
 *
 * Returns the header alone — the caller sends the request itself, so this stays
 * testable against the RFC 5849 example vectors.
 */
export function buildAuthorizationHeader(
  credentials: OAuth1Credentials,
  options: SignOptions,
): string {
  const url = new URL(options.url);
  const method = options.method.toUpperCase();

  // The base string URL excludes the query string and any default port.
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: options.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(options.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  if (credentials.token) {
    oauthParams["oauth_token"] = credentials.token;
  }

  const allParams: Array<[string, string]> = [
    ...Object.entries(oauthParams),
    ...[...url.searchParams.entries()],
    ...Object.entries(options.formParams ?? {}),
  ];

  const baseString = [
    method,
    percentEncode(baseUrl),
    percentEncode(normalizeParams(allParams)),
  ].join("&");

  const signingKey = [
    percentEncode(credentials.consumerSecret),
    percentEncode(credentials.tokenSecret ?? ""),
  ].join("&");

  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const rendered = Object.entries(headerParams)
    .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ");

  return `OAuth ${rendered}`;
}
