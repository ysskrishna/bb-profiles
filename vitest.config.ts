import { defineConfig } from "vitest/config";

// Unit tests only; scripts use node:test (`npm run test:scripts`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
