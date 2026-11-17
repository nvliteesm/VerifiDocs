import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load the local env files so the dev Neon branch variables reach the tests. process.loadEnvFile
// never overrides a variable that is already set, so the dev file is loaded first and wins over
// .env.local. Tests that touch the database only run when NEON_BRANCH is "dev".
for (const file of [".env.development.local", ".env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
