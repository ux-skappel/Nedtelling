import { expect, test } from "@playwright/test";
import { answerCurrent, startAssessment } from "./helpers";

test("reloading mid-test resumes at the same question and keeps answers", async ({ page }) => {
  await startAssessment(page, "quick");
  await page.getByRole("button", { name: /Start practice/ }).click();
  for (let i = 0; i < 3; i++) await answerCurrent(page);
  for (let i = 0; i < 3; i++) await answerCurrent(page);
  await expect(page.getByTestId("item-progress").filter({ visible: true }).filter({ hasText: /Question 4 of up to 22/ })).toBeVisible();
  const promptBefore = await page.getByRole("heading", { level: 2 }).first().textContent();

  await page.reload();
  await expect(page.getByTestId("item-progress").filter({ visible: true }).filter({ hasText: /Question 4 of up to 22/ })).toBeVisible();
  await expect(page.getByText(/Resumed after an interruption/)).toBeVisible();
  expect(await page.getByRole("heading", { level: 2 }).first().textContent()).toBe(promptBefore);

  // The home page offers to continue, and continuing returns to the same place.
  await page.goto("/");
  await page.getByRole("link", { name: "Continue where you left off" }).click();
  await expect(page.getByTestId("item-progress").filter({ visible: true }).filter({ hasText: /Question 4 of up to 22/ })).toBeVisible();
});

test("ending early leads to partial results", async ({ page }) => {
  await startAssessment(page, "quick");
  await page.getByRole("button", { name: /Start practice/ }).click();
  for (let i = 0; i < 3; i++) await answerCurrent(page);
  for (let i = 0; i < 2; i++) await answerCurrent(page);
  await page.getByRole("button", { name: "Exit" }).click();
  await page.getByRole("button", { name: "End and see results" }).click();
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await expect(page.getByText("Ended early").first()).toBeVisible();
});
