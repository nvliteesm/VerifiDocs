import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The eval run (npm run eval): real models, real Crossref/OpenAlex, the Neon dev branch. Never part of npm test or CI.
// Env files load as in vitest.config.ts: the dev file first, so its NEON_BRANCH and database win.
for (const file of [".env.development.local", ".env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    // Forty claims, three runs, live models: allow up to an hour.
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
  },
});
