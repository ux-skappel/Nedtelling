import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * End-to-end tests. By default they build and start the production server on
 * port 3200. Set E2E_BASE_URL to test an already running server instead.
 *
 * In environments with a pre-installed Chromium (PW_CHROMIUM or
 * /opt/pw-browsers/chromium) that binary is used; otherwise run
 * `npx playwright install chromium` first.
 */
const preinstalled = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium";
const launchOptions = existsSync(preinstalled) ? { executablePath: preinstalled } : {};
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3200";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL, trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run build && npm run start -- --port 3200", url: baseURL, timeout: 240_000, reuseExistingServer: true },
});
