import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // next dev would otherwise generate an AGENTS.md. CLAUDE.md is the single source of agent guidance.
  agentRules: false,
};

export default nextConfig;
