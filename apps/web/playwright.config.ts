import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3101;
const WEB_PORT = 5174;

/**
 * One end-to-end journey against the real API (fake AI, in-memory store, so
 * no keys or database are needed) and the Vite dev server.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "pnpm --filter @career-intel/api exec tsx src/server.ts",
      url: `http://localhost:${API_PORT}/ready`,
      reuseExistingServer: false,
      env: {
        API_PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        FAKE_AI: "1",
        EMBEDDING_PROVIDER: "fake",
        DATABASE_URL: "",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
