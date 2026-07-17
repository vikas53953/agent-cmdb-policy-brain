import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Route protection. Next.js 16 renamed "middleware" to "proxy"; proxy runs on the
// Node.js runtime, so the Auth.js database-session check can live here directly via
// the `auth()` wrapper (`request.auth`).
//
// Every route requires a signed-in user EXCEPT the Auth.js endpoints themselves
// (/api/auth/*), which include the sign-in page and OAuth callback and therefore must
// stay reachable without a session — otherwise the redirect would loop. Unauthenticated
// requests to anything else are sent to the built-in sign-in page.
//
// FAIL CLOSED: the default branch requires auth. New public routes must be added to the
// allowlist explicitly and matched EXACTLY (never `startsWith("/")`, which would make
// the whole app public).
export default auth((request) => {
  const { pathname } = request.nextUrl;
  const authed = Boolean(request.auth?.user);

  const isPublic = pathname.startsWith("/api/auth");

  if (!authed && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/auth/signin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

// Skip static assets and image optimisation so the gate runs only on real routes.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
