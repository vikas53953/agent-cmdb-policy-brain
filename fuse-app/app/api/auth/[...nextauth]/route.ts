// Auth.js v5 catch-all route handler. Serves /api/auth/* — sign-in, OAuth callback,
// session, csrf, and sign-out — plus the built-in sign-in page at /api/auth/signin
// (the redirect target the proxy and requireUser() send signed-out visitors to until
// a branded /login lands with the app shell).
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
