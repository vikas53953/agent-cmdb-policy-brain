import AppChrome, { type ShellUser } from "@/components/ui/app-chrome";
import { getUser } from "@/lib/auth-session";
import { getLyricsEnabled, getCrossfadeSec, CROSSFADE_DEFAULT_SEC } from "@/lib/repos/settings";

// The signed-in app shell (U4): the phone-frame layout, the top bar (brand + profile
// avatar), the fixed bottom dock (persistent mini-player + bottom tabs), and the
// profile settings sheet. Every real app page (Home, Search, DJ, Library) renders
// inside this chrome. The branded /login screen deliberately sits OUTSIDE this group
// so a signed-out visitor never sees the app's tabs or a dead Sign-out control.
//
// The whole group is per-user and auth-gated (the proxy redirects signed-out visitors
// to /login), so rendering is dynamic — there is nothing meaningful to prerender.
export const dynamic = "force-dynamic";

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

// Read the user's crossfade length (R3/R16) so the blend engine and the profile-sheet
// slider start from the persisted value. Guarded like the lyrics read: a signed-out /
// keyless / no-DATABASE_URL environment degrades to the default length, never throws.
async function resolveCrossfadeSec(user: ShellUser | null): Promise<number> {
  if (!user) return CROSSFADE_DEFAULT_SEC;
  try {
    const session = await getUser();
    if (!session) return CROSSFADE_DEFAULT_SEC;
    return await getCrossfadeSec(session.id);
  } catch {
    return CROSSFADE_DEFAULT_SEC;
  }
}

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await resolveShellUser();
  const lyricsEnabled = await resolveLyricsEnabled(user);
  const crossfadeSec = await resolveCrossfadeSec(user);

  return (
    <AppChrome user={user} lyricsEnabled={lyricsEnabled} crossfadeSec={crossfadeSec}>
      {children}
    </AppChrome>
  );
}
