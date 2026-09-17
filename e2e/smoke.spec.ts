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

test("runs real Python and imports numpy", async ({ page }) => {
  await seedPad(page, 'import numpy as np\nprint("sum:", np.arange(10).sum())\n');
  await page.goto("/");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("Loading numpy");
  await expect(output(page)).toContainText("sum: 45");
  await expect(output(page)).toContainText("Finished in");
});

test("shows a Python traceback that points at main.py", async ({ page }) => {
  await seedPad(page, "def f():\n    return 1 / 0\n\nf()\n");
  await page.goto("/");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText('File "main.py", line 2, in f');
  await expect(output(page)).toContainText("ZeroDivisionError: division by zero");
  await expect(output(page)).toContainText("Exited with code 1");
});

test("stops an infinite loop and can run again", async ({ page }) => {
  await seedPad(page, 'import itertools\nfor i in itertools.count():\n    print("tick", i)\n');
  await page.goto("/");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("tick");

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(output(page)).toContainText("Stopped.");

  // A new pad starts from the hello-world template.
  await page.getByRole("button", { name: "New pad" }).click();
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("Hello, World!");
  await expect(output(page)).not.toContainText("tick");
});

test("keeps edits across a reload and runs with the keyboard shortcut", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("print(6*7)");

  await page.reload();
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("print(6*7)");

  await expect(runButton(page)).toBeEnabled();
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(output(page)).toContainText("42");
});

// Regression: when React renders fell behind the keystrokes, a controlled editor overwrote
// itself with stale text, and the unload flush saved a snapshot from before the last keys.
test("fast typing on a slow machine is neither dropped nor lost on reload", async ({ page }) => {
  // Starts from an empty pad rather than select-all: Monaco applies a selection to its native
  // edit context on the next frame, so text typed in the same frame as Cmd+A lands at the old
  // cursor. No person types that fast, and it is not what this test is about.
  await seedPad(page, "");
  const cdp = await page.context().newCDPSession(page);
  await page.goto("/");
  await page.locator(".monaco-editor").first().click();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const typed = "total=sum(range(1000))#abcdefghijklmnopqrstuvwxyz";
  await page.keyboard.type(typed);

  const lines = page.locator(".monaco-editor .view-lines").first();
  await expect(lines).toHaveText(typed, { timeout: 15_000 });

  // Reload straight away, inside the autosave debounce window.
  await page.reload();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await expect(page.locator(".monaco-editor .view-lines").first()).toHaveText(typed, { timeout: 15_000 });
});

test("timer counts down and survives a reload", async ({ page }) => {
  await page.goto("/");
  const timer = page.getByRole("timer");
  await expect(timer).toContainText("45:00");
  await timer.getByRole("button", { name: "Start" }).click();
  await expect(timer).toContainText(/44:5\d/);

  await page.reload();
  await expect(page.getByRole("timer")).toContainText(/44:\d\d/);
  await expect(page.getByRole("timer").getByRole("button", { name: "Pause" })).toBeVisible();
});

test("command palette drives the app from the keyboard", async ({ page }) => {
  await page.goto("/");
  const palette = page.getByRole("dialog", { name: "Command palette" });

  // From inside the editor, where Monaco would otherwise swallow the shortcut.
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+K");
  await expect(palette).toBeVisible();
  // Playwright's browser reports a light system theme, so dark is the observable change.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.type("theme dark");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // The theme choice persists.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // From the visible trigger, then by initials: "np" finds "New pad".
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.keyboard.type("np");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Pad title")).toHaveValue("Untitled pad 2");

  // Escape closes without running anything.
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(page.getByLabel("Pad title")).toHaveValue("Untitled pad 2");
});

test("notes are kept per pad, and running code returns to the output tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByLabel("Notes for this pad").fill("edge case: empty input");

  await page.reload();
  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.getByLabel("Notes for this pad")).toHaveValue("edge case: empty input");

  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(page.getByRole("tab", { name: "Program Output" })).toHaveAttribute("aria-selected", "true");
  await expect(output(page)).toContainText("Hello, World!");
});
