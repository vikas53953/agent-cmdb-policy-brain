// Which routes are reachable WITHOUT a signed-in session. Kept in a pure, dependency-
// free module (no next/server import) so the proxy's fail-closed policy can be unit-
// tested (public-paths.test.ts) without standing up the Auth.js runtime.
//
// FAIL CLOSED: everything NOT matched here requires auth. New public routes must be
// added EXPLICITLY and matched exactly — never a `startsWith("/")` that would make the
// whole app public.

// The Auth.js endpoints (sign-in POST, OAuth callback, CSRF, session) must stay
// reachable without a session, or the sign-in redirect would loop.
const AUTH_PREFIX = "/api/auth";

// Exact-match public pages. The branded sign-in screen (/login) must be reachable by a
// signed-out visitor so the proxy can redirect them there.
export const PUBLIC_EXACT: readonly string[] = ["/login"];

export function isPublicPath(pathname: string): boolean {
  if (pathname === AUTH_PREFIX || pathname.startsWith(AUTH_PREFIX + "/")) return true;
  return PUBLIC_EXACT.includes(pathname);
}
