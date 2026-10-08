import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startAssessment } from "./helpers";

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.help}`);
  expect(summary, summary.join("\n")).toEqual([]);
}

for (const path of ["/", "/start/quick", "/start/full", "/methodology", "/history"]) {
  test(`no WCAG A/AA violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await axe(page);
  });
}

test("no violations on a section intro, a practice item and a test item", async ({ page }) => {
  await startAssessment(page, "quick");
  await axe(page);
  await page.getByRole("button", { name: /Start practice/ }).click();
  await expect(page.getByRole("radio").first()).toBeVisible();
  await axe(page);
});

test("an item can be answered with the keyboard alone", async ({ page }) => {
  await startAssessment(page, "quick");
  await page.keyboard.press("Enter"); // begin practice from the intro
  for (let i = 0; i < 3; i++) {
    await expect(page.getByRole("radio").first()).toBeVisible();
    await page.keyboard.press("2");
    await expect(page.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter"); // check answer
    await expect(page.getByRole("status")).toBeVisible();
    await page.keyboard.press("Enter"); // continue
  }
  await expect(page.getByTestId("item-progress").filter({ visible: true }).filter({ hasText: /Question 1 of up to 22/ })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio").first()).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("item-progress").filter({ visible: true }).filter({ hasText: /Question 2 of up to 22/ })).toBeVisible();
});

test("the results page has no violations", async ({ page }) => {
  const session = readFileSync(resolve(__dirname, "fixtures/full-session.json"), "utf8");
  const id = JSON.parse(session).id as string;
  await page.goto("/history");
  await page.evaluate(([s, sid]) => {
    const p = JSON.parse(s);
    localStorage.setItem(`iqa:v1:session:${sid}`, s);
    localStorage.setItem("iqa:v1:index", JSON.stringify([{ id: sid, mode: p.mode, createdAt: p.createdAt, completedAt: p.completedAt, endedEarly: false }]));
  }, [session, id]);
  await page.goto(`/results/${id}`);
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await page.waitForTimeout(500);
  await axe(page);
});
