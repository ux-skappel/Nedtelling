import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { noHorizontalOverflow, startAssessment } from "./helpers";

test.describe("mobile usability", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile project only");

  for (const path of ["/", "/start/quick", "/methodology", "/history"]) {
    test(`${path} fits the screen`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noHorizontalOverflow(page);
    });
  }

  test("test items fit the screen and answer options are large enough to tap", async ({ page }) => {
    await startAssessment(page, "quick");
    await page.getByRole("button", { name: /Start practice/ }).click();
    for (let i = 0; i < 3; i++) {
      const radios = page.getByRole("radio");
      await expect(radios.first()).toBeVisible();
      await noHorizontalOverflow(page);
      for (const box of await radios.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await radios.first().click();
      await page.getByRole("button", { name: /Check answer/ }).click();
      await page.getByRole("button", { name: /^Continue/ }).click();
    }
    await expect(page.getByRole("radio").first()).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test("the results page fits the screen", async ({ page }) => {
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
    await noHorizontalOverflow(page);
  });
});
