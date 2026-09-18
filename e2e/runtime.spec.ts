import { expect, test, type Page } from "@playwright/test";

/** Seeds one pad before the app boots. Skipped on reloads so later edits survive. */
async function seedPad(page: Page, code: string) {
  await page.addInitScript((source) => {
    if (localStorage.getItem("coderpad-sim:pads")) return;
    const now = Date.now();
    const pad = { id: "seed", title: "Seeded pad", code: source, createdAt: now, updatedAt: now };
    localStorage.setItem("coderpad-sim:pads", JSON.stringify([pad]));
    localStorage.setItem("coderpad-sim:active-pad", "seed");
  }, code);
}

// input() blocks the worker on a SharedArrayBuffer, which only exists on isolated pages.
test("the page is cross-origin isolated", async ({ page }) => {
  await seedPad(page, "");
  await page.goto("/");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});
