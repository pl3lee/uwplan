import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  outputDir: "../output/playwright-web/results",
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "../output/playwright-web/report" },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:4173/signin",
    reuseExistingServer: false,
    env: { HOST: "127.0.0.1", PORT: "4173", API_ORIGIN: "http://127.0.0.1:1" },
  },
});
