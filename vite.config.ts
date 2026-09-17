import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (GitHub Pages).
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
