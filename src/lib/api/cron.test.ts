import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqlLike } from "../rag/retrieve";
import { purgeCron } from "./cron";

const SECRET = "a-long-random-test-secret";
const request = (authorization?: string) =>
  new Request("https://example.test/api/cron/purge", { headers: authorization ? { authorization } : {} });

/** A stand-in for the sql tag: any query returns one purge_expired() row. */
const sqlReturning = (row: Record<string, number>) => vi.fn(async () => [row]) as unknown as SqlLike;

afterEach(() => vi.restoreAllMocks());

describe("purgeCron", () => {
  it("fails closed when no secret is configured, and never opens the database", async () => {
    for (const secret of [undefined, "", "   "]) {
      const getSql = vi.fn();
      const response = await purgeCron(request(`Bearer ${SECRET}`), { getSql, secret });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "not_configured" } });
      expect(getSql).not.toHaveBeenCalled();
    }
  });

  it("refuses a missing, malformed or wrong secret with 401, and never opens the database", async () => {
    for (const header of [undefined, "", "Bearer", "Bearer ", `Basic ${SECRET}`, SECRET, "Bearer wrong", `Bearer ${SECRET}x`, `bearer ${SECRET}`]) {
      const getSql = vi.fn();
      const response = await purgeCron(request(header), { getSql, secret: SECRET });
      expect(response.status, String(header)).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
      expect(getSql).not.toHaveBeenCalled();
    }
  });

  it("runs the purge for the right secret and answers with counts only", async () => {
    const sql = sqlReturning({ runs_deleted: 3, documents_deleted: 2, sessions_deleted: 1 });
    const response = await purgeCron(request(`Bearer ${SECRET}`), { getSql: () => sql, secret: SECRET });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, runsDeleted: 3, documentsDeleted: 2, sessionsDeleted: 1 });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("accepts a secret with surrounding whitespace in the configuration", async () => {
    const sql = sqlReturning({ runs_deleted: 0, documents_deleted: 0, sessions_deleted: 0 });
    const response = await purgeCron(request(`Bearer ${SECRET}`), { getSql: () => sql, secret: `  ${SECRET}\n` });
    expect(response.status).toBe(200);
  });

  it("answers 500 when the database fails, without echoing the error or the secret", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw Object.assign(new Error("password authentication failed for user secret-user"), { name: "PostgresError" });
    }) as unknown as SqlLike;
    const response = await purgeCron(request(`Bearer ${SECRET}`), { getSql: () => failing, secret: SECRET });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("purge_failed");
    expect(text).not.toContain("secret-user");
    expect(text).not.toContain(SECRET);
    expect(logged).toHaveBeenCalledWith("Scheduled purge failed: PostgresError");
  });
});
