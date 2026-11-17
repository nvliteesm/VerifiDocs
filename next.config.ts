import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

// Content-Security-Policy, production only (the dev server needs eval and a websocket for hot reload).
// Inline scripts are allowed because Next.js writes small inline scripts into every page and the theme script in
// layout.tsx runs before first paint; a per-request nonce would force every page to render per request.
// The rest still blocks what matters here: other sites framing the app, other origins for data, plugins and base tags.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(production
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not announce the framework in every response.
  poweredByHeader: false,
  // next dev would otherwise generate an AGENTS.md. CLAUDE.md is the single source of agent guidance.
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
