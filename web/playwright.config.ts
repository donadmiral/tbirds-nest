import { defineConfig } from "@playwright/test";

// Alignment proof for the web app: every page at four widths, with and without an input focused.
// Runs against the local dev server by default; set E2E_BASE_URL to point it at a deployment.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
