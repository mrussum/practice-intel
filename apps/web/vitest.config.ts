import { defineConfig } from "vitest/config";

export default defineConfig({
  // Plain node environment: components are tested via react-dom/server,
  // so no DOM emulation dependency is needed.
  test: { include: ["test/**/*.test.{ts,tsx}"], environment: "node" },
});
