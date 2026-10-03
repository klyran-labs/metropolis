import { defineConfig, devices } from "@playwright/test";

const PORT = 3118;

// Point the suite at an already running server (for example the production nginx image) instead of
// building and previewing locally.
const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: externalBaseUrl ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npx vite build --config vite.e2e.config.ts --outDir dist-e2e --emptyOutDir && npx vite preview --config vite.e2e.config.ts --outDir dist-e2e --port ${PORT} --strictPort`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        env: {
          VITE_APP_ENV: "local",
          VITE_APP_TARGET: "unified",
          VITE_CHAIN_ID: "10143",
          VITE_RPC_URL: "http://127.0.0.1:8545",
        },
        timeout: 120_000,
      },
});
