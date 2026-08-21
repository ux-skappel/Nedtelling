import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolInputError } from "../src/errors.js";
import { validatePath } from "../src/mcp/tools/raw.js";

test("Connect API service paths are accepted and normalized", () => {
  assert.equal(
    validatePath("/metrics-service/metrics/hillscore/2026-08-01"),
    "/metrics-service/metrics/hillscore/2026-08-01",
  );
  assert.equal(validatePath("wellness-service/wellness/daily/im/2026-08-01"), "/wellness-service/wellness/daily/im/2026-08-01");
  assert.equal(validatePath("/mobile-gateway/heartRate/forDate/2026-08-01").startsWith("/mobile-gateway/"), true);
});

test("anything that is not a Connect API path is refused", () => {
  for (const path of [
    "/etc/passwd",
    "/activity-service/../../secret",
    "https://evil.example.com/steal",
    "//evil.example.com/steal",
    "/activity-service/activity?limit=1",
    "/service/activity",
  ]) {
    assert.throws(() => validatePath(path), ToolInputError, `should refuse ${path}`);
  }
});
