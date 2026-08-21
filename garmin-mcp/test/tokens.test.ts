import assert from "node:assert/strict";
import { test } from "node:test";
import { GarminAuthError } from "../src/errors.js";
import { isExpired, parseTokenBlob, serializeTokens, withExpiry } from "../src/garmin/tokens.js";

const oauth1 = {
  oauth_token: "token",
  oauth_token_secret: "secret",
  domain: "garmin.com",
};

test("a garth-style base64 pair round-trips", () => {
  const oauth2 = withExpiry(
    {
      scope: "CONNECT_READ",
      jti: "id",
      token_type: "Bearer",
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3_600,
      refresh_token_expires_in: 31_536_000,
    },
    1_700_000_000_000,
  );

  const parsed = parseTokenBlob(serializeTokens({ oauth1, oauth2 }));
  assert.equal(parsed.oauth1.oauth_token, "token");
  assert.equal(parsed.oauth1.domain, "garmin.com");
  assert.equal(parsed.oauth2?.access_token, "access");
  assert.equal(parsed.oauth2?.expires_at, 1_700_003_600);
});

test("bare JSON and an OAuth1-only blob are both accepted", () => {
  assert.equal(parseTokenBlob(JSON.stringify([oauth1, null])).oauth2, null);
  assert.equal(parseTokenBlob(JSON.stringify(oauth1)).oauth1.oauth_token_secret, "secret");
  assert.equal(
    parseTokenBlob(Buffer.from(JSON.stringify(oauth1)).toString("base64")).oauth1.oauth_token,
    "token",
  );
});

test("a malformed token blob fails with an actionable message", () => {
  assert.throws(() => parseTokenBlob("not-a-token"), GarminAuthError);
  assert.throws(() => parseTokenBlob(JSON.stringify({ oauth_token: "only-half" })), GarminAuthError);
  assert.throws(() => parseTokenBlob("{}"), (error: unknown) => {
    assert.ok(error instanceof GarminAuthError);
    assert.match(error.message, /npm run login/);
    return true;
  });
});

test("an unexpired OAuth2 token is only reused inside its safety margin", () => {
  const token = withExpiry(
    { expires_in: 3_600, refresh_token_expires_in: 0 } as Record<string, unknown>,
    1_700_000_000_000,
  );
  assert.equal(isExpired(token, 60, 1_700_000_000_000), false);
  // Thirty seconds before the stated expiry, the margin already treats it as stale.
  assert.equal(isExpired(token, 60, 1_700_003_570_000), true);
});
