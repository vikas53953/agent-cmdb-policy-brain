// Auth.js (NextAuth v5) configuration — Google sign-in, Prisma adapter, database
// sessions. This is Fuse's sole auth mechanism (R15: anyone can sign up and sign in
// with Google; each account's data is private to it). Mirrors SubTrackr's proven
// setup (KTD-5), minus the email allowlist — Fuse is a PUBLIC app, so any account
// with a Google-verified email may sign in.
//
// `authConfig` is exported separately so the sign-in gate can be unit-tested without
// standing up a real Auth.js runtime or a database.
//
// KEYLESS-SAFE: with GOOGLE_CLIENT_ID/SECRET and DATABASE_URL unset this module still
// imports, typechecks, and builds. Sign-in simply cannot COMPLETE at runtime without
// those values — which is the honest outcome (no fake success), not a crash.

import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { signInGate } from "@/lib/auth-policy";

export const authConfig: NextAuthConfig = {
  // Database sessions: a Session row is the source of truth (revocable server-side),
  // via the Prisma adapter. Requires a User/Account/Session schema (prisma/schema.prisma).
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  // Next 16 binds trusted hosts from AUTH_URL/host headers; required for the proxy
  // runtime session check to work behind Vercel.
  trustHost: true,
  // Send sign-in to Fuse's own branded /login screen instead of Auth.js's default
  // bare button page. Auth.js routes every "you need to sign in" redirect here.
  pages: {
    signIn: "/login",
  },
  providers: [
    // Wire Google to our own env var names (Auth.js v5's bare `Google` would default
    // to AUTH_GOOGLE_ID/SECRET; the plan standardises on GOOGLE_CLIENT_ID/SECRET).
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // Sign-in gate. Returning false aborts sign-in BEFORE any User/Account row is
    // created, so a rejected attempt leaves no trace. Fuse is public: allow any
    // Google account whose email Google asserts as verified. Reject anything else
    // (fail closed) — no other providers are configured.
    async signIn({ account, profile }) {
      return signInGate(account?.provider, (profile as { email_verified?: unknown } | undefined)?.email_verified);
    },
    // Surface the user id to server code (requireUser). The database strategy passes
    // the resolved `user`; copy its id onto session.user so per-user data reads can
    // key on it.
    async session({ session, user }) {
      if (session.user && user?.id) {
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
