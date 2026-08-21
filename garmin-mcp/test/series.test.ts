import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityDetails } from "../src/garmin/endpoints.js";
import { availableChannels, decodeSamples, firstPresent, readDescriptors } from "../src/mcp/series.js";

/** Descriptors deliberately out of order, as Garmin often sends them. */
const details: ActivityDetails = {
  metricDescriptors: [
    { key: "directHeartRate", metricsIndex: 2, unit: { key: "bpm" } },
    { key: "directTimestamp", metricsIndex: 0, unit: { key: "gmt" } },
    { key: "directLatitude", metricsIndex: 1 },
    { key: "brokenNoIndex" },
    { key: "brokenNegative", metricsIndex: -1 },
  ],
  activityDetailMetrics: [
    { metrics: [1_700_000_000_000, 59.91, 140] },
    { metrics: [1_700_000_001_000, 59.92, 142] },
    { metrics: [1_700_000_002_000, 59.93] }, // truncated row: no heart rate
  ],
};

test("descriptors without a usable index are dropped", () => {
  assert.deepEqual(
    readDescriptors(details).map((descriptor) => descriptor.key),
    ["directHeartRate", "directTimestamp", "directLatitude"],
  );
});

test("decodeSamples names each position from the descriptors", () => {
  const samples = decodeSamples(details);
  assert.deepEqual(samples[0], {
    directHeartRate: 140,
    directTimestamp: 1_700_000_000_000,
    directLatitude: 59.91,
  });
});

test("a channel missing from a row is omitted, not invented", () => {
  const samples = decodeSamples(details);
  assert.equal("directHeartRate" in (samples[2] ?? {}), false);
  assert.equal(samples[2]?.directLatitude, 59.93);
});

test("decodeSamples can project onto a subset of channels", () => {
  const samples = decodeSamples(details, ["directTimestamp", "directHeartRate"]);
  assert.deepEqual(samples[1], { directTimestamp: 1_700_000_001_000, directHeartRate: 142 });
});

test("availableChannels reports units where Garmin gave one", () => {
  assert.deepEqual(availableChannels(details), [
    { key: "directHeartRate", unit: "bpm" },
    { key: "directTimestamp", unit: "gmt" },
    { key: "directLatitude", unit: null },
  ]);
});

test("firstPresent picks the first spelling the device actually recorded", () => {
  const descriptors = readDescriptors(details);
  assert.equal(firstPresent(descriptors, ["directElevation", "directLatitude"]), "directLatitude");
  assert.equal(firstPresent(descriptors, ["directPower"]), null);
});

test("an activity with no samples decodes to an empty series", () => {
  assert.deepEqual(decodeSamples({}), []);
  assert.deepEqual(availableChannels({}), []);
});
