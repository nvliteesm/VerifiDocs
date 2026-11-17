import { afterEach, describe, expect, it, vi } from "vitest";
import { callerAddress, trustsProxyHeaders } from "./rate-limit";

const forged = () => new Request("http://localhost:3000/api/sources", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1", "x-real-ip": "8.8.8.8" } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("callerAddress", () => {
  it("ignores forwarded-address headers when no proxy is trusted, so a forged header cannot dodge a limit", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    expect(trustsProxyHeaders()).toBe(false);
    expect(callerAddress(forged())).toBe("unknown");
    expect(callerAddress(new Request("http://localhost:3000/"))).toBe("unknown");
  });

  it("uses the first forwarded address on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(trustsProxyHeaders()).toBe(true);
    expect(callerAddress(forged())).toBe("9.9.9.9");
  });

  it("uses the forwarded address when the operator says the proxy is theirs", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "1");
    expect(callerAddress(forged())).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip, then to unknown, behind a trusted proxy", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "1");
    expect(callerAddress(new Request("http://localhost:3000/", { headers: { "x-real-ip": "8.8.8.8" } }))).toBe("8.8.8.8");
    expect(callerAddress(new Request("http://localhost:3000/"))).toBe("unknown");
  });
});
