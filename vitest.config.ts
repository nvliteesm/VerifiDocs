import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load the local env files so the dev Neon branch variables reach the tests. process.loadEnvFile
// never overrides a variable that is already set, so the dev file is loaded first and wins over
// .env.local. Tests that touch the database only run when NEON_BRANCH is "dev".
// VERIFIDOCS_NO_ENV_FILES=1 (npm run test:ci) skips them, so the run sees what GitHub's CI sees: no keys, no database.
// Without it a plain `npm test` always finds your keys here and passes, which hid a CI failure for six commits.
if (process.env.VERIFIDOCS_NO_ENV_FILES !== "1") {
  for (const file of [".env.development.local", ".env.local"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Component tests are .test.tsx and opt into jsdom with a "@vitest-environment jsdom" comment on their first line.
    // evals/*.test.ts are the eval's own unit tests (scoring); the eval run itself is evals/*.eval.ts (npm run eval).
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts", "evals/**/*.test.ts"],
    environment: "node",
    // Database tests talk to Neon over the internet, and a waking compute can add seconds.
    testTimeout: 30_000,
  },
});
