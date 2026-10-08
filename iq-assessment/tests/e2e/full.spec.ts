import { expect, test, type Page } from "@playwright/test";
import { answerCurrent, startAssessment } from "./helpers";

/**
 * Drives a complete full-mode assessment through the real UI: adaptive
 * sections, span tasks (answered wrongly so they end quickly), the reaction
 * check and both 60-second speed blocks. Takes about three minutes.
 */
test("@slow a full assessment runs through all nine sections to results", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop only (long-running)");
  test.setTimeout(10 * 60_000);
  await startAssessment(page, "full");
  const seen: string[] = [];

  for (let step = 0; step < 600 && !page.url().includes("/results/"); step++) {
    const begin = page.getByRole("button", { name: /^(Start practice|Begin)/ });
    const watch = page.getByText(/^Watch the (sequence|blocks)\.$/);
    const reaction = page.getByRole("heading", { name: "Reaction check" });
    const speedPractice = page.getByText(/Practice \d of 4 — not scored/);
    const speedStart = page.getByRole("button", { name: /Start the 60-second task/ });
    const question = page.getByRole("radio").first().or(page.getByPlaceholder("Your answer"));
    const results = page.getByRole("heading", { name: "Your results" });
    await expect(begin.or(watch).or(reaction).or(speedPractice).or(speedStart).or(question).or(results).first()).toBeVisible({ timeout: 30_000 });

    if (await results.isVisible()) {
      break;
    } else if (await begin.isVisible()) {
      seen.push((await page.locator("h1").textContent()) ?? "");
      await begin.click();
    } else if (await watch.isVisible()) {
      await page.getByRole("button", { name: /^Done/ }).waitFor({ timeout: 30_000 });
      const key = page.getByRole("button", { name: "1", exact: true });
      if (await key.isVisible()) await key.click();
      else await page.getByRole("button", { name: "Block 1", exact: true }).click();
      await page.getByRole("button", { name: /^Done/ }).click();
      const cont = page.getByRole("button", { name: /^Continue/ });
      if (await cont.isVisible().catch(() => false)) await cont.click();
    } else if (await reaction.isVisible()) {
      await reactionCheck(page);
    } else if (await speedPractice.isVisible()) {
      await page.keyboard.press("f");
      await page.waitForTimeout(1000);
    } else if (await speedStart.isVisible()) {
      await speedStart.click();
      const bar = page.getByRole("progressbar", { name: "Time remaining" });
      for (let n = 0; (await bar.isVisible().catch(() => false)) && n < 400; n++) {
        await page.keyboard.press(n % 2 ? "j" : "f");
        await page.waitForTimeout(250);
      }
    } else {
      await answerCurrent(page);
    }
  }

  expect(seen).toEqual([
    "Fluid reasoning",
    "Digit memory — forward",
    "Digit memory — backward",
    "Visual-spatial reasoning",
    "Processing speed",
    "Quantitative reasoning",
    "Sequence reordering",
    "Spatial memory",
    "Verbal knowledge",
  ]);
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your provisional ability profile" })).toBeVisible();
  for (const d of ["Fluid reasoning", "Visual-spatial processing", "Quantitative reasoning", "Working memory", "Processing speed"]) {
    await expect(page.getByRole("heading", { name: d, level: 3 })).toBeVisible();
  }
  await expect(page.getByRole("table", { name: "Processing speed tasks" })).toBeVisible();
});

async function reactionCheck(page: Page) {
  await page.getByRole("button", { name: "Start" }).click();
  for (let i = 0; i < 12; i++) {
    await page.getByRole("button", { name: "Respond now" }).waitFor({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Space");
    await page.waitForTimeout(150);
    if (!(await page.getByRole("heading", { name: "Reaction check" }).isVisible().catch(() => false))) return;
  }
}
