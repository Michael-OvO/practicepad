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

const runButton = (page: Page) => page.getByRole("button", { name: "Run", exact: true });
const output = (page: Page) => page.getByLabel("Program output");
const programInput = (page: Page) => page.getByLabel("Program input");

// input() blocks the worker on a SharedArrayBuffer, which only exists on isolated pages.
test("the page is cross-origin isolated", async ({ page }) => {
  await seedPad(page, "");
  await page.goto("/");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});

test("Python loads on the first run, not when the page opens", async ({ page }) => {
  await seedPad(page, 'print("later")\n');
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Python loads on first run");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("Loading Python… (first run only)");
  await expect(output(page)).toContainText("later");
  await expect(page.getByRole("status")).toContainText("Python ready");
});

test("input() pauses for a line typed into the console, and echoes it", async ({ page }) => {
  await seedPad(page, 'name = input("Name: ")\nage = input("Age: ")\nprint(f"{name} is {age}")\n');
  await page.goto("/");
  await runButton(page).click();

  await expect(output(page)).toContainText("Name:");
  await expect(programInput(page)).toBeFocused();
  await page.keyboard.type("Ada");
  await page.keyboard.press("Enter");
  await expect(output(page)).toContainText("Name: Ada");

  await expect(output(page)).toContainText("Age:");
  await programInput(page).fill("36");
  await page.keyboard.press("Enter");
  await expect(output(page)).toContainText("Ada is 36");
  await expect(output(page)).toContainText("Finished in");
  await expect(programInput(page)).toHaveCount(0);
});

test("Ctrl+D ends input() with EOFError, and Stop works while waiting", async ({ page }) => {
  await seedPad(page, "input()\n");
  await page.goto("/");
  await runButton(page).click();
  await expect(programInput(page)).toBeVisible();
  await page.keyboard.press("Control+d");
  await expect(output(page)).toContainText("EOFError");
  await expect(output(page)).toContainText("Exited with code 1");

  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(programInput(page)).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(output(page)).toContainText("Stopped.");
  await expect(programInput(page)).toHaveCount(0);
  await expect(runButton(page)).toBeEnabled();
});
