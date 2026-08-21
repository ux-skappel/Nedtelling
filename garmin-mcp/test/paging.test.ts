import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate, paginateWithinBudget, type Page } from "../src/mcp/paging.js";

const series = Array.from({ length: 250 }, (_, index) => index);

test("paginate returns the requested window and where to continue", () => {
  const first = paginate(series, { offset: 0, limit: 100 });
  assert.deepEqual(first.items[0], 0);
  assert.equal(first.items.length, 100);
  assert.equal(first.page.total, 250);
  assert.equal(first.page.nextOffset, 100);
  assert.equal(first.page.hasMore, true);

  const last = paginate(series, { offset: 200, limit: 100 });
  assert.equal(last.page.returned, 50);
  assert.equal(last.page.nextOffset, null);
  assert.equal(last.page.hasMore, false);
});

test("paginate clamps nonsense input instead of throwing", () => {
  assert.equal(paginate(series, { offset: -10, limit: 5 }).page.offset, 0);
  assert.equal(paginate(series, { offset: 9_000, limit: 5 }).page.returned, 0);
  assert.equal(paginate([], {}).page.hasMore, false);
});

test("walking nextOffset visits every sample exactly once", () => {
  const seen: number[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page: Page<number> = paginate(series, { offset, limit: 60 });
    seen.push(...page.items);
    offset = page.page.nextOffset;
  }
  assert.deepEqual(seen, series);
});

test("paginateWithinBudget shrinks the window to fit and says so", () => {
  const samples = Array.from({ length: 1_000 }, (_, index) => ({
    timestamp: 1_700_000_000_000 + index * 1_000,
    heartRate: 120 + (index % 40),
  }));

  const page = paginateWithinBudget(samples, { offset: 0, limit: 1_000 }, 4_000);
  assert.equal(page.page.limitAdjusted, true);
  assert.ok(page.items.length < 1_000, "window should have been cut down");
  assert.ok(Buffer.byteLength(JSON.stringify(page.items), "utf8") <= 4_000);
  assert.equal(page.page.nextOffset, page.items.length);
  assert.equal(page.page.total, 1_000);
});

test("paginateWithinBudget leaves a window that already fits alone", () => {
  const page = paginateWithinBudget(series, { offset: 10, limit: 20 }, 1_000_000);
  assert.equal(page.page.limitAdjusted, undefined);
  assert.equal(page.items.length, 20);
});
