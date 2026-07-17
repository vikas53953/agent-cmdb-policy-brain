import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppChrome, { type ShellUser } from "@/components/ui/app-chrome";
import { getUser } from "@/lib/auth-session";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await resolveShellUser();

  return (
    <html lang="en">
      <body>
        <AppChrome user={user}>{children}</AppChrome>
      </body>
    </html>
  );
}
