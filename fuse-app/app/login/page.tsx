import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { getUser } from "@/lib/auth-session";

// The branded sign-in screen. Fuse is a public app (R15): anyone can sign in with a
// Google account. This is the honest front door — a real Fuse-branded surface, NOT
// Auth.js's default bare button page (which the app's design rules forbid). It renders
// OUTSIDE the (app) route group, so it carries no app tabs and no dead Sign-out
// control (R17: no dead controls on a signed-out page).
//
// It reads the session, so it renders dynamically; a signed-in visitor is bounced
// straight to the app.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · Fuse",
  description: "Sign in to Fuse — one player for every music source.",
};

// The one real control on this page: a form whose server action starts Google sign-in
// and lands the user on the home feed. This is a genuine POST → OAuth redirect, never a
// decorative button.
async function signInWithGoogle() {
  "use server";
  await signIn("google", { redirectTo: "/" });
}

export default async function LoginPage() {
  // A signed-in visitor has no business on the sign-in screen — send them to the app.
  // Guarded so a keyless / no-DATABASE_URL environment degrades to the signed-out
  // screen instead of throwing. redirect() throws NEXT_REDIRECT, so it stays OUTSIDE
  // the try/catch (never swallowed).
  let user = null;
  try {
    user = await getUser();
  } catch {
    user = null;
  }
  if (user) {
    redirect("/");
  }

  return (
    <main className="login-screen" data-testid="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-wordmark">Fuse</span>
          <span className="login-blend-dot" aria-hidden="true" />
        </div>

        <p className="login-tagline">Music that melts together.</p>
        <p className="login-lede">
          One player for every source — YouTube, Spotify, and your own files, blended into
          one continuous listen.
        </p>

        <form action={signInWithGoogle} className="login-form">
          <button type="submit" className="login-google">
            <svg
              className="login-google-g"
              viewBox="0 0 18 18"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                fill="#EA4335"
                d="M9 3.48c1.69 0 2.84.73 3.49 1.34l2.55-2.49C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"
              />
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72l2.84 2.2c1.66-1.53 2.76-3.78 2.76-6.57z"
              />
              <path
                fill="#FBBC05"
                d="M3.87 10.78a5.4 5.4 0 0 1-.28-1.78c0-.62.11-1.22.28-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.91-2.26z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.79.53-1.83.9-3.12.9-2.38 0-4.4-1.57-5.13-3.74L.96 13.04C2.44 15.98 5.48 18 9 18z"
              />
            </svg>
            Continue with Google
          </button>
        </form>

        <p className="login-footnote">
          Signing in needs a Google account — that&apos;s the only way in for now, and
          your library stays private to you.
        </p>
      </div>
    </main>
  );
}
