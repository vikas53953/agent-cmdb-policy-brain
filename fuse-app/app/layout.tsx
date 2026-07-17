import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppChrome, { type ShellUser } from "@/components/ui/app-chrome";
import { getUser } from "@/lib/auth-session";
import { getLyricsEnabled } from "@/lib/repos/settings";

// U4 ships the real app shell: the phone-frame layout, the top bar (brand + profile
// avatar), the fixed bottom dock (persistent mini-player scaffold + bottom tabs), and
// the profile settings sheet. Every page renders inside this chrome.
//
// The whole app is per-user and auth-gated (the proxy redirects signed-out visitors),
// so rendering is dynamic — there is nothing meaningful to prerender statically.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fuse",
  description: "One player for every music source — songs that melt into each other.",
};

export const viewport: Viewport = {
  themeColor: "#0b0e12",
};

// Resolve the signed-in user for the shell (avatar + settings header). Guarded so a
// keyless / no-DATABASE_URL environment degrades to a signed-out shell instead of
// throwing — the honest outcome, never a crash. Never logs or exposes any secret.
async function resolveShellUser(): Promise<ShellUser | null> {
  try {
    const user = await getUser();
    if (!user) return null;
    return { name: user.name, email: user.email, image: user.image };
  } catch {
    return null;
  }
}

// Read the user's Lyrics on/off setting (R16) so Now Playing and the profile sheet
// start from the persisted value. Guarded: a signed-out / keyless / no-DATABASE_URL
// environment degrades to the default (lyrics ON) instead of throwing.
async function resolveLyricsEnabled(user: ShellUser | null): Promise<boolean> {
  if (!user) return true;
  try {
    const session = await getUser();
    if (!session) return true;
    return await getLyricsEnabled(session.id);
  } catch {
    return true;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await resolveShellUser();
  const lyricsEnabled = await resolveLyricsEnabled(user);

  return (
    <html lang="en">
      <body>
        <AppChrome user={user} lyricsEnabled={lyricsEnabled}>
          {children}
        </AppChrome>
      </body>
    </html>
  );
}
