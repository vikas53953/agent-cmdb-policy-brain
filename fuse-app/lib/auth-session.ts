// Server-side session helper. This is the single entry point server components and
// route handlers use to resolve the signed-in user before touching any per-user data.
//
//   - requireUser(): resolve the user, or REDIRECT to sign-in if there is none. Use in
//     pages/server components that must not render for a signed-out visitor. (The proxy
//     already gates protected routes; requireUser is the second line of defence that
//     also hands back the typed user.)
//   - getUser(): resolve the user or return null — for code paths that branch on auth
//     rather than hard-failing.
//
// Both share one per-request session read, memoized with React `cache()`, so the
// layout and a page each calling these resolve the session (a DB hit under the
// database strategy) only once per render.

import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type SessionUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
};

// Fuse's branded sign-in screen (lib/auth.ts sets pages.signIn to this too, and the
// proxy redirects signed-out visitors here). Keeping it in one place avoids drift.
export const SIGN_IN_PATH = "/login";

// Resolve the Auth.js session at most once per request.
const getSession = cache(() => auth());

type RawUser = { id?: string; email?: string | null; name?: string | null; image?: string | null };

function toSessionUser(raw: RawUser | undefined): SessionUser | null {
  if (!raw?.id) return null;
  return {
    id: raw.id,
    email: raw.email ?? null,
    name: raw.name ?? null,
    image: raw.image ?? null,
  };
}

// Resolve the current user, or redirect to sign-in. Never returns a user without an id.
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  const user = toSessionUser(session?.user as RawUser | undefined);
  if (!user) {
    redirect(SIGN_IN_PATH); // throws NEXT_REDIRECT — control never returns past here
  }
  return user;
}

// Like requireUser but returns null instead of redirecting.
export async function getUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return toSessionUser(session?.user as RawUser | undefined);
}
