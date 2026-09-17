import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
// Set E2E_BASE_URL to test an already-running or deployed copy instead of building one here.
const externalUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  // Room for the first run to download Pyodide and numpy from the CDN, without letting a
  // genuine failure stall for minutes.
  timeout: 90_000,
  expect: { timeout: 45_000 },
  workers: 1,
  use: {
    baseURL: externalUrl ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalUrl
    ? undefined
    : {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
