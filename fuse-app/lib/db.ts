// Prisma client singleton (Neon serverless adapter), mirroring SubTrackr's proven
// db.ts (KTD-5). U2 BOOTSTRAP SCOPE: the auth unit needs a PrismaClient to hand to
// @auth/prisma-adapter, so it stands this file up. U3 owns the wider schema and the
// repos layer on top of this same client — it should reuse this file, not replace it.
//
// KEYLESS-SAFE BY DESIGN: constructing PrismaClient does not open a connection — the
// driver connects lazily on the first query. So importing this module with
// DATABASE_URL unset is safe (build/typecheck/test never touch the network); only an
// actual query at runtime would fail, and that surfaces as an honest error, not a
// crash at import.

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// The Neon serverless driver talks to Postgres over a WebSocket to the Neon proxy
// instead of a raw TCP+TLS socket — much cheaper per serverless invocation. Node 22+
// ships a global WebSocket; on older Node (Vercel can run >=20.9) it is absent, so
// supply the `ws` implementation the driver needs.
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

// Reuse a single client across dev hot-reloads so we don't exhaust the connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Use the Neon driver adapter when DATABASE_URL is a Neon connection string; if that
// fails for any reason, fall back to the plain client so a non-Neon/local DB still
// works. With DATABASE_URL unset we simply build the plain client (no connection yet).
function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (url && /neon\.tech/i.test(url)) {
    try {
      const adapter = new PrismaNeon({ connectionString: url });
      return new PrismaClient({ adapter });
    } catch (err) {
      console.warn(
        "[db] Neon adapter unavailable; falling back to the default Prisma client.",
        err,
      );
    }
  }
  return new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
