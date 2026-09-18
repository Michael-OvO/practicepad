import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Makes the page cross-origin isolated, which is what gives the Python worker SharedArrayBuffer
// (used to block on input()). vercel.json sends the same headers in production.
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (GitHub Pages).
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
