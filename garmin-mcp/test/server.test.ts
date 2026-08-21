/**
 * End-to-end test over a real MCP client/server pair, with Garmin stubbed out.
 *
 * Exercises what a client actually does: negotiate, list the tools, call them,
 * and page through a series.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetConfig } from "../src/config.js";
import { clearCache } from "../src/garmin/cache.js";
import { resetAuthCache } from "../src/garmin/auth.js";
import { createServer } from "../src/mcp/server.js";
import { serializeTokens } from "../src/garmin/tokens.js";

const nowSeconds = Math.floor(Date.now() / 1000);

const TOKEN = serializeTokens({
  oauth1: { oauth_token: "t", oauth_token_secret: "s", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "id",
    token_type: "Bearer",
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3_600,
    expires_at: nowSeconds + 3_600,
    refresh_token_expires_in: 31_536_000,
    refresh_token_expires_at: nowSeconds + 31_536_000,
  },
});

/** 300 samples of timestamp, latitude, longitude and heart rate. */
const ACTIVITY_DETAILS = {
  activityId: 42,
  measurementCount: 300,
  metricDescriptors: [
    { key: "directTimestamp", metricsIndex: 0, unit: { key: "gmt" } },
    { key: "directHeartRate", metricsIndex: 3, unit: { key: "bpm" } },
    { key: "directLatitude", metricsIndex: 1, unit: { key: "dd" } },
    { key: "directLongitude", metricsIndex: 2, unit: { key: "dd" } },
  ],
  activityDetailMetrics: Array.from({ length: 300 }, (_, index) => ({
    metrics: [1_700_000_000_000 + index * 1_000, 59.9 + index / 10_000, 10.7 + index / 10_000, 130 + (index % 20)],
  })),
};

const SLEEP = {
  dailySleepDTO: { sleepTimeSeconds: 27_000 },
  sleepLevels: Array.from({ length: 40 }, (_, index) => ({ activityLevel: index % 4 })),
  sleepHeartRate: Array.from({ length: 120 }, (_, index) => ({ value: 50 + (index % 10) })),
};

const ROUTES: Array<[RegExp, unknown]> = [
  [/\/userprofile-service\/socialProfile$/, { displayName: "abc-123", userName: "runner" }],
  [/\/userprofile-service\/userprofile\/user-settings$/, { userData: { measurementSystem: "metric" } }],
  [
    /\/activitylist-service\/activities\/search\/activities/,
    [
      { activityId: 42, activityName: "Morning Run", startTimeLocal: "2026-08-20 06:12:00", distance: 10_120.4 },
      { activityId: 41, activityName: "Evening Ride", startTimeLocal: "2026-08-19 18:02:00", distance: 30_500.1 },
    ],
  ],
  [/\/activity-service\/activity\/42\/details/, ACTIVITY_DETAILS],
  [/\/activity-service\/activity\/42$/, { activityId: 42, activityName: "Morning Run" }],
  [/\/wellness-service\/wellness\/dailySleepData\//, SLEEP],
  [/\/download-service\/export\/gpx\/activity\/42$/, "<gpx><trk><name>Morning Run</name></trk></gpx>"],
];

let requestedUrls: string[] = [];
const realFetch = globalThis.fetch;

before(() => {
  process.env["GARMIN_TOKEN"] = TOKEN;
  process.env["MCP_AUTH_TOKEN"] = "test-secret";
  resetConfig();
  resetAuthCache();
  clearCache();

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const route = ROUTES.find(([pattern]) => pattern.test(url.split("?")[0] ?? url));
    if (!route) return new Response("not found", { status: 404 });
    const [, payload] = route;
    return typeof payload === "string"
      ? new Response(payload, { status: 200, headers: { "Content-Type": "application/gpx+xml" } })
      : Response.json(payload);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

async function connect(): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function payloadOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  assert.equal(content[0]?.type, "text");
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

test("the server advertises its tools", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);

  for (const expected of [
    "garmin_get_profile",
    "garmin_list_activities",
    "garmin_get_activity_details",
    "garmin_get_heart_rate_series",
    "garmin_get_gps_track",
    "garmin_get_sleep",
    "garmin_download_activity_file",
    "garmin_get_raw",
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
  }
  await client.close();
});

test("listing activities returns Garmin's records untouched", async () => {
  const client = await connect();
  const payload = payloadOf(await client.callTool({ name: "garmin_list_activities", arguments: { limit: 2 } }));

  const data = payload["data"] as Array<Record<string, unknown>>;
  assert.equal(data.length, 2);
  assert.equal(data[0]?.["activityName"], "Morning Run");
  assert.equal(data[0]?.["distance"], 10_120.4);
  assert.equal((payload["page"] as Record<string, unknown>)["hasMore"], true);
  await client.close();
});

test("fields projects the summary without altering values", async () => {
  const client = await connect();
  const payload = payloadOf(
    await client.callTool({
      name: "garmin_list_activities",
      arguments: { limit: 2, fields: ["activityId", "distance"] },
    }),
  );
  assert.deepEqual((payload["data"] as unknown[])[0], { activityId: 42, distance: 10_120.4 });
  await client.close();
});

test("includeSamples=false describes the activity without shipping it", async () => {
  const client = await connect();
  const payload = payloadOf(
    await client.callTool({
      name: "garmin_get_activity_details",
      arguments: { activityId: 42, includeSamples: false },
    }),
  );

  const data = payload["data"] as Record<string, unknown>;
  assert.equal(data["sampleCount"], 300);
  assert.equal(data["measurementCount"], 300);
  assert.deepEqual(data["channels"], [
    { key: "directTimestamp", unit: "gmt" },
    { key: "directHeartRate", unit: "bpm" },
    { key: "directLatitude", unit: "dd" },
    { key: "directLongitude", unit: "dd" },
  ]);
  await client.close();
});

test("sample pages carry every value and chain to the next offset", async () => {
  const client = await connect();
  const collected: Array<Record<string, number>> = [];
  let offset: number | null = 0;

  while (offset !== null) {
    const payload = payloadOf(
      await client.callTool({
        name: "garmin_get_activity_details",
        arguments: { activityId: 42, offset, limit: 120, metrics: ["directTimestamp", "directHeartRate"] },
      }),
    );
    const data = payload["data"] as { samples: Array<Record<string, number>> };
    collected.push(...data.samples);
    offset = (payload["page"] as { nextOffset: number | null }).nextOffset;
  }

  assert.equal(collected.length, 300);
  assert.deepEqual(collected[0], { directTimestamp: 1_700_000_000_000, directHeartRate: 130 });
  assert.deepEqual(collected[299], { directTimestamp: 1_700_000_299_000, directHeartRate: 149 });
  await client.close();
});

test("the positional format returns Garmin's own arrays", async () => {
  const client = await connect();
  const payload = payloadOf(
    await client.callTool({
      name: "garmin_get_activity_details",
      arguments: { activityId: 42, format: "positional", limit: 1 },
    }),
  );
  const data = payload["data"] as { samples: unknown[]; format: string };
  assert.equal(data.format, "positional");
  assert.deepEqual(data.samples[0], [1_700_000_000_000, 59.9, 10.7, 130]);
  await client.close();
});

test("the GPS track picks the position channels on its own", async () => {
  const client = await connect();
  const payload = payloadOf(
    await client.callTool({ name: "garmin_get_gps_track", arguments: { activityId: 42, limit: 3 } }),
  );
  const data = payload["data"] as { channels: string[]; points: Array<Record<string, number>> };
  assert.deepEqual(data.channels, ["directTimestamp", "directLatitude", "directLongitude"]);
  assert.equal(data.points.length, 3);
  assert.equal(data.points[0]?.["directLatitude"], 59.9);
  await client.close();
});

test("sleep answers with an index first, then the series asked for", async () => {
  const client = await connect();

  const index = payloadOf(await client.callTool({ name: "garmin_get_sleep", arguments: { date: "2026-08-20" } }));
  const indexData = index["data"] as { series: Array<{ key: string; length: number }> };
  assert.deepEqual(indexData.series, [
    { key: "sleepLevels", length: 40 },
    { key: "sleepHeartRate", length: 120 },
  ]);

  const series = payloadOf(
    await client.callTool({
      name: "garmin_get_sleep",
      arguments: { date: "2026-08-20", series: "heartRate", offset: 100, limit: 50 },
    }),
  );
  const page = series["page"] as Record<string, unknown>;
  assert.equal(page["returned"], 20);
  assert.equal(page["total"], 120);
  assert.equal(page["hasMore"], false);
  await client.close();
});

test("files come back byte for byte, in ranges", async () => {
  const client = await connect();
  const payload = payloadOf(
    await client.callTool({
      name: "garmin_download_activity_file",
      arguments: { activityId: 42, format: "gpx", limit: 10 },
    }),
  );
  const data = payload["data"] as { content: string; encoding: string; byteLength: number };
  assert.equal(data.encoding, "text");
  assert.equal(data.content, "<gpx><trk>");
  assert.equal((payload["page"] as { hasMore: boolean }).hasMore, true);
  await client.close();
});

test("paging a cached activity does not re-fetch it", async () => {
  clearCache();
  requestedUrls = [];
  const client = await connect();
  await client.callTool({ name: "garmin_get_activity_details", arguments: { activityId: 42, limit: 10 } });
  await client.callTool({ name: "garmin_get_activity_details", arguments: { activityId: 42, offset: 10, limit: 10 } });

  const detailCalls = requestedUrls.filter((url) => url.includes("/details"));
  assert.equal(detailCalls.length, 1);
  await client.close();
});

test("bad input comes back as a tool error, not a crash", async () => {
  const client = await connect();

  const badId = await client.callTool({ name: "garmin_get_activity_details", arguments: { activityId: "42; drop" } });
  assert.equal(badId.isError, true);
  assert.match(payloadOf(badId)["message"] as string, /positive integer/);

  const badPath = await client.callTool({ name: "garmin_get_raw", arguments: { path: "/etc/passwd" } });
  assert.equal(badPath.isError, true);
  assert.equal(payloadOf(badPath)["error"], "invalid_input");
  await client.close();
});

test("an upstream failure is reported with its status", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "garmin_get_activity", arguments: { activityId: 999 } });
  assert.equal(result.isError, true);
  assert.equal(payloadOf(result)["error"], "not_found");
  await client.close();
});
