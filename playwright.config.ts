import { defineConfig, devices } from "@playwright/test";

const outputRoot = "output/playwright-go";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: `${outputRoot}/report` }],
  ],
  outputDir: `${outputRoot}/results`,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_CHROMIUM_CHANNEL,
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grep: /@smoke/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@smoke/ },
    { name: "mobile", use: { ...devices["iPhone 13"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: "node e2e/start-go.mjs",
    url: `${process.env.E2E_BASE_URL}/signin`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
