import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  buildAuthorizationHeader,
  normalizeParams,
  percentEncode,
} from "../src/garmin/oauth1.js";

test("percentEncode follows RFC 3986, not encodeURIComponent", () => {
  assert.equal(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(percentEncode("An encoded string!"), "An%20encoded%20string%21");
  assert.equal(percentEncode("Dogs, Cats & Mice"), "Dogs%2C%20Cats%20%26%20Mice");
  // Unreserved characters must survive untouched.
  assert.equal(percentEncode("aA-._~0"), "aA-._~0");
  // encodeURIComponent leaves these alone; OAuth requires them encoded.
  assert.equal(percentEncode("!'()*"), "%21%27%28%29%2A");
});

test("normalizeParams matches the RFC 5849 example", () => {
  // The parameter set from RFC 5849 §3.4.1.3.1, in scrambled order and with
  // the repeated `a3` key that makes value-sorting observable.
  const params: Array<[string, string]> = [
    ["b5", "=%3D"],
    ["a3", "a"],
    ["c@", ""],
    ["a2", "r b"],
    ["oauth_consumer_key", "9djdj82h48djs9d2"],
    ["oauth_token", "kkk9d7dh3k39sjv7"],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", "137131201"],
    ["oauth_nonce", "7d8f3e4a"],
    ["c2", ""],
    ["a3", "2 q"],
  ];

  assert.equal(
    normalizeParams(params),
    "a2=r%20b&a3=2%20q&a3=a&b5=%3D%253D&c%40=&c2=&oauth_consumer_key=9djdj82h48djs9d2" +
      "&oauth_nonce=7d8f3e4a&oauth_signature_method=HMAC-SHA1&oauth_timestamp=137131201" +
      "&oauth_token=kkk9d7dh3k39sjv7",
  );
});

test("buildAuthorizationHeader signs over URL, query and form parameters", () => {
  const header = buildAuthorizationHeader(
    { consumerKey: "ck", consumerSecret: "cs", token: "tok", tokenSecret: "ts" },
    {
      method: "post",
      url: "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0?ticket=ST-1",
      formParams: { audience: "GARMIN_CONNECT_MOBILE_ANDROID_DI" },
      nonce: "nonce123",
      timestamp: 1_700_000_000,
    },
  );

  // The base string is written out by hand here, so the test checks how the
  // request is composed rather than re-running the implementation.
  const baseString = [
    "POST",
    percentEncode("https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0"),
    percentEncode(
      "audience=GARMIN_CONNECT_MOBILE_ANDROID_DI&oauth_consumer_key=ck&oauth_nonce=nonce123" +
        "&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1700000000&oauth_token=tok" +
        "&oauth_version=1.0&ticket=ST-1",
    ),
  ].join("&");
  const expected = createHmac("sha1", "cs&ts").update(baseString).digest("base64");

  const signature = /oauth_signature="([^"]+)"/.exec(header)?.[1];
  assert.equal(signature, percentEncode(expected));
  assert.match(header, /^OAuth /);
  assert.match(header, /oauth_token="tok"/);
});

test("a two-legged request signs with an empty token secret", () => {
  const header = buildAuthorizationHeader(
    { consumerKey: "ck", consumerSecret: "cs" },
    { method: "GET", url: "https://connectapi.garmin.com/oauth-service/oauth/preauthorized?ticket=T" },
  );
  assert.doesNotMatch(header, /oauth_token=/);
  assert.match(header, /oauth_signature_method="HMAC-SHA1"/);
});
