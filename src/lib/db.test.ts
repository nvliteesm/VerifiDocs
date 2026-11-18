import { describe, expect, it } from "vitest";
import { isWakingError } from "./db";

const withCode = (code: string) => Object.assign(new Error("x"), { code });

describe("isWakingError", () => {
  it("is true for the errors that mean the database cannot be reached right now, so the browser retries", () => {
    for (const code of ["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P03", "08006"]) {
      expect(isWakingError(withCode(code)), code).toBe(true);
    }
  });

  it("is true for a DNS lookup that failed for a moment", () => {
    expect(isWakingError(withCode("ENOTFOUND"))).toBe(true);
    expect(isWakingError(withCode("EAI_AGAIN"))).toBe(true);
  });

  it("is true for an error that wraps only such errors (a connection tried on several addresses)", () => {
    expect(isWakingError({ errors: [withCode("ENOTFOUND"), withCode("ECONNREFUSED")] })).toBe(true);
  });

  it("is false for a problem with the query or the data, which retrying cannot fix", () => {
    expect(isWakingError(withCode("23505"))).toBe(false); // unique violation
    expect(isWakingError(withCode("42P01"))).toBe(false); // missing table
    expect(isWakingError({ errors: [withCode("ENOTFOUND"), withCode("23505")] })).toBe(false);
    expect(isWakingError(new Error("plain"))).toBe(false);
    expect(isWakingError(null)).toBe(false);
    expect(isWakingError("ENOTFOUND")).toBe(false);
  });
});
