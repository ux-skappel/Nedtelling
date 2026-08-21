import assert from "node:assert/strict";
import { test } from "node:test";
import { indexSeries, resolveSeries, summarize } from "../src/mcp/document.js";

const night = {
  dailySleepDTO: { sleepTimeSeconds: 27_000, sleepScores: { overall: { value: 82 } } },
  sleepLevels: [{ startGMT: "2026-08-20T22:10:00.0" }, { startGMT: "2026-08-20T22:40:00.0" }],
  sleepMovement: [{ activityLevel: 1.2 }],
  wellnessEpochSPO2DataDTOList: [{ spo2Reading: 95 }],
  restlessMomentsCount: 12,
};

test("indexSeries lists the sample series and their lengths", () => {
  assert.deepEqual(indexSeries(night), [
    { key: "sleepLevels", length: 2 },
    { key: "sleepMovement", length: 1 },
    { key: "wellnessEpochSPO2DataDTOList", length: 1 },
  ]);
});

test("summarize keeps the scalars and replaces series with their lengths", () => {
  const summary = summarize(night) as Record<string, unknown>;
  assert.deepEqual(summary["sleepLevels"], { seriesLength: 2 });
  assert.equal(summary["restlessMomentsCount"], 12);
  assert.deepEqual(summary["dailySleepDTO"], night.dailySleepDTO);
});

test("resolveSeries accepts an alias, the raw key, or a different case", () => {
  const aliases = { levels: "sleepLevels", spo2: "wellnessEpochSPO2DataDTOList" };
  assert.equal(resolveSeries(night, "levels", aliases)?.key, "sleepLevels");
  assert.equal(resolveSeries(night, "sleepMovement", aliases)?.key, "sleepMovement");
  assert.equal(resolveSeries(night, "spo2", aliases)?.key, "wellnessEpochSPO2DataDTOList");
  assert.equal(resolveSeries(night, "sleeplevels", aliases)?.key, "sleepLevels");
  assert.equal(resolveSeries(night, "nothingLikeThis", aliases), null);
});

test("a document that is itself an array is addressed as (root)", () => {
  const days = [{ date: "2026-08-19" }, { date: "2026-08-20" }];
  assert.deepEqual(indexSeries(days), [{ key: "(root)", length: 2 }]);
  assert.equal(resolveSeries(days, "(root)", {})?.items.length, 2);
  assert.equal(resolveSeries(days, "days", { days: "(root)" })?.items.length, 2);
  assert.equal(resolveSeries(days, "elsewhere", {}), null);
});

test("an empty response yields no series rather than throwing", () => {
  assert.deepEqual(indexSeries(null), []);
  assert.equal(resolveSeries(null, "anything", {}), null);
});
