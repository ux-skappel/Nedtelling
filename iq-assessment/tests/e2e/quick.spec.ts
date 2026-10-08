import { expect, test } from "@playwright/test";
import { answerCurrent, startAssessment } from "./helpers";

test("a quick assessment runs from start to results", async ({ page }) => {
  test.setTimeout(240_000);
  await startAssessment(page, "quick");
  await expect(page.getByRole("heading", { name: "Fluid reasoning" })).toBeVisible();
  await page.getByRole("button", { name: /Start practice/ }).click();

  // Practice items show feedback; test items do not.
  await expect(page.getByText("Practice — not scored")).toBeVisible();
  for (let i = 0; i < 3; i++) await answerCurrent(page);

  let answered = 0;
  while (!page.url().includes("/results/")) {
    const progress = page.getByTestId("item-progress").filter({ visible: true });
    await expect(progress.or(page.getByRole("heading", { name: "Your results" })).first()).toBeVisible();
    if (page.url().includes("/results/")) break;
    await answerCurrent(page);
    answered++;
    await page.waitForURL(/\/(test|results\/.+)$/);
    if (answered > 25) throw new Error("Too many items");
  }
  expect(answered).toBeGreaterThanOrEqual(12);
  expect(answered).toBeLessThanOrEqual(22);

  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await expect(page.getByText("These are provisional results, not an IQ score.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Norm-referenced scores are not available" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Provisional level \d of 5/ })).toBeVisible();
  // No norm-referenced numbers are shown without norms.
  await expect(page.getByText("Full-scale estimate", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Standard score" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Percentile" })).toHaveCount(0);
});
