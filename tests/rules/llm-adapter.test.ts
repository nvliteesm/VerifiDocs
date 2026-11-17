// Enforces hard rule 2: Gemini is called only through the single adapter, with no hardcoded model name.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ADAPTER_DIR = join("src", "lib", "llm");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

// Application and script code only. Tests may mention model names as fixtures.
const candidates = ["src", "scripts"]
  .flatMap((dir) => sourceFiles(join(ROOT, dir)))
  .map((file) => relative(ROOT, file))
  .filter((file) => !file.startsWith(ADAPTER_DIR + sep))
  .filter((file) => !/\.test\.(ts|tsx)$/.test(file));

describe("single LLM adapter (hard rule 2)", () => {
  it("scans some files, so the check cannot pass by finding nothing", () => {
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("no file outside src/lib/llm imports the Gemini SDK", () => {
    const offenders = candidates.filter((file) =>
      /from\s+["']@google\/genai["']|require\(["']@google\/genai["']\)/.test(
        readFileSync(join(ROOT, file), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("no file outside src/lib/llm hardcodes a gemini model name", () => {
    const offenders = candidates.filter((file) =>
      /["'`]gemini-[a-z0-9.-]+["'`]/i.test(readFileSync(join(ROOT, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the adapter itself has no hardcoded gemini model name", () => {
    const adapter = readFileSync(join(ROOT, ADAPTER_DIR, "adapter.ts"), "utf8");
    expect(/["'`]gemini-[a-z0-9.-]+["'`]/i.test(adapter)).toBe(false);
  });
});
