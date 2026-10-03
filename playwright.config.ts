import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** Cross-browser projects: E2E_BROWSERS=all (CI) or a comma list, e.g. "webkit,firefox". Chromium always runs. */
const extra = (process.env.E2E_BROWSERS ?? "").split(",").map((s) => s.trim());
const want = (name: string) => extra.includes("all") || extra.includes(name);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Tests decode and export multi-megapixel images; cap parallelism so GPU/CPU contention cannot cause timeouts.
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
    ...(want("firefox")
      ? [
          {
            name: "desktop-firefox",
            use: {
              ...devices["Desktop Firefox"],
              viewport: { width: 1440, height: 900 },
              launchOptions: {
                firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true },
              },
            },
            testIgnore: /mobile\.spec\.ts/,
          },
        ]
      : []),
    ...(want("webkit")
      ? [
          {
            name: "desktop-webkit",
            use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
            testIgnore: /mobile\.spec\.ts/,
          },
        ]
      : []),
  ],
  webServer: {
    // Tests run against the production build (service worker enabled).
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
