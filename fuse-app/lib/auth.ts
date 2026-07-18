// Auth.js (NextAuth v5) configuration — Google sign-in, Prisma adapter, database
// sessions. This is Fuse's sole HUMAN auth mechanism (R15: anyone can sign up and sign
// in with Google; each account's data is private to it). Mirrors SubTrackr's proven
// setup (KTD-5), minus the email allowlist — Fuse is a PUBLIC app, so any account with
// a Google-verified email may sign in.
//
// `authConfig` is exported separately so the sign-in gate can be unit-tested without
// standing up a real Auth.js runtime or a database.
//
// KEYLESS-SAFE: with GOOGLE_CLIENT_ID/SECRET and DATABASE_URL unset this module still
// imports, typechecks, and builds. Sign-in simply cannot COMPLETE at runtime without
// those values — which is the honest outcome (no fake success), not a crash.
//
// THE ROBOT TEST DOOR (lib/robot-door.ts): a SECOND, secret-gated Credentials provider
// "e2e-robot" is registered ONLY when E2E_TEST_SECRET is set to a strong value. It lets
// the Playwright robot sign in on real deployments without Google (Google correctly
// blocks robots), so the release gate and the live-site watchman can exercise the
// signed-in app. It is off by default (no env => no provider => nothing to attack) and
// requires an exact secret match. Because Auth.js's Credentials provider cannot issue
// DATABASE sessions, the presence of the door flips the session strategy to JWT (the
// same proven trade SubTrackr's dev-login makes); the robot's user id is still a real
// row (robot@fuse.test) resolved from the database when one is reachable.

import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { signInGate } from "@/lib/auth-policy";
import {
  ROBOT_EMAIL,
  ROBOT_NAME,
  ROBOT_PROVIDER_ID,
  isRobotDoorEnabled,
  robotDoorSecret,
  robotSecretMatches,
} from "@/lib/robot-door";

// The configured door secret (or null when the door is closed). Read once at module
// load; the strength/length check lives in robot-door.ts (fails closed).
const robotSecret = robotDoorSecret();
const robotDoorOpen = isRobotDoorEnabled();

// Resolve (or create) the dedicated robot user row and return the identity the session
// keys on. Tries the database first so the robot's id matches a real User row on a
// provisioned deployment (its likes/playlists then persist). If no database is
// reachable (a keyless local/CI run), it falls back to a STABLE synthetic id so the
// robot can still sign in and exercise the DB-free journeys — DB-backed writes on such
// a run honestly fail, which the specs treat as an environment limitation, not a pass.
async function resolveRobotUser(): Promise<{ id: string; email: string; name: string }> {
  try {
    const existing = await prisma.user.findUnique({ where: { email: ROBOT_EMAIL } });
    if (existing) return { id: existing.id, email: ROBOT_EMAIL, name: existing.name ?? ROBOT_NAME };
    const created = await prisma.user.create({ data: { email: ROBOT_EMAIL, name: ROBOT_NAME } });
    return { id: created.id, email: ROBOT_EMAIL, name: ROBOT_NAME };
  } catch {
    return { id: "e2e-robot-fuse-test", email: ROBOT_EMAIL, name: ROBOT_NAME };
  }
}

const providers: Provider[] = [
  // Wire Google to our own env var names (Auth.js v5's bare `Google` would default to
  // AUTH_GOOGLE_ID/SECRET; the plan standardises on GOOGLE_CLIENT_ID/SECRET).
  Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }),
];

if (robotDoorOpen) {
  providers.push(
    Credentials({
      id: ROBOT_PROVIDER_ID,
      name: "E2E Robot",
      // The ONE credential: the shared secret. Sign-in succeeds only on an exact match
      // of the configured E2E_TEST_SECRET (constant-time compare in robot-door.ts).
      credentials: { secret: { label: "Secret", type: "password" } },
      async authorize(credentials) {
        if (!robotSecretMatches(credentials?.secret, robotSecret)) return null;
        return resolveRobotUser();
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  // Database sessions are the default (revocable, server-side truth). Auth.js's
  // Credentials provider cannot use them, so when the robot door is open the strategy
  // flips to JWT — exactly the trade SubTrackr's dev-login makes. The Google path is
  // unaffected in shape; only where sessions are stored changes.
  adapter: PrismaAdapter(prisma),
  session: { strategy: robotDoorOpen ? "jwt" : "database" },
  // Next 16 binds trusted hosts from AUTH_URL/host headers; required for the proxy
  // runtime session check to work behind Vercel.
  trustHost: true,
  // Send sign-in to Fuse's own branded /login screen instead of Auth.js's default bare
  // button page. Auth.js routes every "you need to sign in" redirect here.
  pages: {
    signIn: "/login",
  },
  providers,
  callbacks: {
    // Sign-in gate. Returning false aborts sign-in BEFORE any User/Account row is
    // created, so a rejected attempt leaves no trace. Fuse is public: allow any Google
    // account whose email Google asserts as verified. The robot door is exempt — it
    // already proved the shared secret in authorize(), which is its whole security.
    async signIn({ account, profile }) {
      if (account?.provider === ROBOT_PROVIDER_ID) return true;
      return signInGate(account?.provider, (profile as { email_verified?: unknown } | undefined)?.email_verified);
    },
    // JWT strategy (robot door open): persist the user id on the token at sign-in so
    // requireUser() can read it back from the session. A no-op under the database
    // strategy (no token), so it is harmless to always define.
    async jwt({ token, user }) {
      if (user?.id) (token as { id?: string }).id = user.id;
      return token;
    },
    // Surface the user id to server code (requireUser). The database strategy passes the
    // resolved `user`; the JWT strategy passes the `token`. Copy whichever carries it
    // onto session.user so per-user data reads can key on it.
    async session({ session, user, token }) {
      if (session.user) {
        const id = user?.id ?? (token as { id?: string } | undefined)?.id;
        if (id) (session.user as { id?: string }).id = id;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
