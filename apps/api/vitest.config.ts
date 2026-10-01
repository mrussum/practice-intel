import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The Postgres integration test starts a container on first run.
    hookTimeout: 120_000,
  },
});
