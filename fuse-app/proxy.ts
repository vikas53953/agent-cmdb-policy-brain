import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPublicPath } from "@/lib/public-paths";

// Route protection. Next.js 16 renamed "middleware" to "proxy"; proxy runs on the
// Node.js runtime, so the Auth.js database-session check can live here directly via
// the `auth()` wrapper (`request.auth`).
//
// Every route requires a signed-in user EXCEPT the public routes (the Auth.js endpoints
// under /api/auth/* and the branded /login screen), which must stay reachable without a
// session — otherwise the sign-in redirect would loop. Unauthenticated requests to
// anything else are sent to the branded /login page.
//
// FAIL CLOSED: the default branch requires auth. The public allowlist lives in
// lib/public-paths.ts and is matched EXACTLY (never `startsWith("/")`, which would make
// the whole app public).
export default auth((request) => {
  const { pathname } = request.nextUrl;
  const authed = Boolean(request.auth?.user);

  if (!authed && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

// Skip static assets and image optimisation so the gate runs only on real routes.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
