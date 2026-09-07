import { defineConfig } from "@playwright/test";

// End-to-end smoke suite against the live site by default; E2E_BASE_URL overrides.
export default defineConfig({
  testDir: "./e2e",
  timeout: 600_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://platinumcircles.app",
    viewport: { width: 390, height: 844 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});