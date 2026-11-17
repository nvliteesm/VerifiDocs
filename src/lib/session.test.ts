import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  buildSessionCookie,
  hashToken,
  isSecureRequest,
  newToken,
  readCookie,
} from "./session";

describe("tokens", () => {
  it("are 256 random bits, url-safe, and different every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("are stored only as a SHA-256 hash that does not contain the token", () => {
    const token = newToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(newToken())).not.toBe(hash);
  });
});

describe("readCookie", () => {
  it("finds a cookie among several, ignoring spacing", () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=abc; b=2`, SESSION_COOKIE)).toBe("abc");
    expect(readCookie(`${SESSION_COOKIE}=abc`, SESSION_COOKIE)).toBe("abc");
    expect(readCookie(`x=1;   ${SESSION_COOKIE}= abc `, SESSION_COOKIE)).toBe("abc");
  });

  it("does not match a cookie whose name only ends the same way", () => {
    expect(readCookie(`not_${SESSION_COOKIE}=abc`, SESSION_COOKIE)).toBeNull();
  });

  it("returns null for no header, no match, or a value-less part", () => {
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
    expect(readCookie("", SESSION_COOKIE)).toBeNull();
    expect(readCookie("a=1", SESSION_COOKIE)).toBeNull();
    expect(readCookie(SESSION_COOKIE, SESSION_COOKIE)).toBeNull();
  });
});

describe("buildSessionCookie", () => {
  const token = newToken();

  it("is HttpOnly, SameSite=Lax, site-wide, and lasts 30 days", () => {
    const cookie = buildSessionCookie(token, false);
    expect(cookie).toContain(`${SESSION_COOKIE}=${token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(SESSION_MAX_AGE_SECONDS).toBe(2_592_000);
  });

  it("adds Secure only when the request is https", () => {
    expect(buildSessionCookie(token, true)).toContain("Secure");
    expect(buildSessionCookie(token, false)).not.toContain("Secure");
  });
});

describe("isSecureRequest", () => {
  it("follows the URL, and the forwarded protocol behind a proxy", () => {
    expect(isSecureRequest(new Request("https://example.com/api"))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost:3000/api"))).toBe(false);
    expect(isSecureRequest(new Request("http://internal/api", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isSecureRequest(new Request("https://example.com/api", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });
});
