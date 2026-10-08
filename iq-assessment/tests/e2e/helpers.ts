import { expect, type Page } from "@playwright/test";

/** Start an assessment from its setup page. */
export async function startAssessment(page: Page, mode: "quick" | "full") {
  await page.goto(`/start/${mode}`);
  await page.getByLabel("Age in years").fill("34");
  await page.getByRole("checkbox", { name: /I understand that this is a research preview/ }).check();
  await page.getByRole("button", { name: /Begin the assessment/ }).click();
  await expect(page).toHaveURL(/\/test$/);
}

/**
 * Answer whatever single choice or numeric question is on screen (option 1,
 * or the number 7) and continue. Returns false if no question was found.
 */
export async function answerCurrent(page: Page): Promise<"item" | "none"> {
  const numeric = page.getByPlaceholder("Your answer");
  const radio = page.getByRole("radio").first();
  await expect(numeric.or(radio).first()).toBeVisible();
  if (await numeric.isVisible()) {
    await numeric.fill("7");
  } else {
    await radio.click();
  }
  const check = page.getByRole("button", { name: /^Check answer/ });
  if (await check.isVisible()) {
    await check.click();
    await page.getByRole("button", { name: /^Continue/ }).click();
  } else {
    await page.getByRole("button", { name: /^Next/ }).click();
  }
  return "item";
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(1);
}
