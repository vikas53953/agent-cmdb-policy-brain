import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

// This repo has a lockfile at its root (the agent-cmdb package) as well as in
// fuse-app/. Next's workspace-root inference would otherwise pick the outer one;
// pin the Turbopack root to this app so builds are deterministic here and on CI.
const appRoot = dirname(fileURLToPath(import.meta.url));

// Security headers live in lib/security-headers.ts (a pure, unit-tested builder).
// See that file's header comment for the KTD-9 rationale: Fuse deliberately
// relaxes SubTrackr's deny-all CSP by exactly the hosts YouTube and Spotify need,
// and nothing more.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  turbopack: { root: appRoot },

  // Let the dev server's HMR resources load when opened via 127.0.0.1 (headless
  // verification), not just localhost. Dev-only; no production effect.
  allowedDevOrigins: ["127.0.0.1"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(isDev) }];
  },
};

export default nextConfig;
