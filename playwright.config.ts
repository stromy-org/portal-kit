import { defineConfig, devices } from "@playwright/test";

// Chromium on every PR; Firefox and WebKit when CSP-sensitive paths change and nightly
// (portal-shell.md decision 11). PK_BROWSERS=all runs the three engines.
const all = process.env.PK_BROWSERS === "all";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  // The fake gatekeeper's scenario is shared state: one worker, in order.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4400", trace: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(all
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
        ]
      : []),
  ],
  webServer: {
    command: "npx vite build --config demo/vite.config.ts --logLevel warn && node e2e/serve.ts",
    url: "http://127.0.0.1:4400/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
