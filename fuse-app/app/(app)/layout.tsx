import AppChrome, { type ShellUser } from "@/components/ui/app-chrome";
import { getUser } from "@/lib/auth-session";
import { getResolvedSettings, DEFAULT_SETTINGS, type ResolvedSettings } from "@/lib/repos/settings";

// The signed-in app shell (U4): the phone-frame layout, the top bar (brand + profile
// avatar), the fixed bottom dock (persistent mini-player + bottom tabs), and the
// profile settings sheet. Every real app page (Home, Search, DJ, Library) renders
// inside this chrome. The branded /login screen deliberately sits OUTSIDE this group
// so a signed-out visitor never sees the app's tabs or a dead Sign-out control.
//
// The whole group is per-user and auth-gated (the proxy redirects signed-out visitors
// to /login), so rendering is dynamic — there is nothing meaningful to prerender.
// `loading.tsx` beside this file gives the dynamic render a streamed skeleton, so a tab
// tap paints instantly instead of sitting on the old screen looking broken.
export const dynamic = "force-dynamic";

// Resolve the shell's data in the FEWEST possible round-trips.
//
// THE BUG THIS KILLS: this used to await six things one after another — the session,
// then lyrics, crossfade, prefer-audio, autoplay-similar and volume, each its own
// findUnique against the same table for the same user. Five serial serverless-Postgres
// round-trips gated every single page render. The fix is one settings read for all of
// them (`getResolvedSettings`), and it is class-level: any setting added later is
// decoded from that same row set instead of adding another trip.
//
// `getUser()` keeps its React `cache()` memoisation, so the session is still resolved
// at most once per request even though pages call it too.
//
// Guarded as before: a signed-out / keyless / no-DATABASE_URL environment degrades to
// the honest defaults instead of throwing. Never logs or exposes any secret.
async function resolveShell(): Promise<{ user: ShellUser | null; settings: ResolvedSettings }> {
  let session: Awaited<ReturnType<typeof getUser>> = null;
  try {
    session = await getUser();
  } catch {
    return { user: null, settings: DEFAULT_SETTINGS };
  }
  if (!session) return { user: null, settings: DEFAULT_SETTINGS };

  const user: ShellUser = { name: session.name, email: session.email, image: session.image };
  // A failed settings read must not un-sign-in the shell — the user is known, only
  // their preferences are not, so fall back to defaults and keep the avatar/profile.
  try {
    return { user, settings: await getResolvedSettings(session.id) };
  } catch {
    return { user, settings: DEFAULT_SETTINGS };
  }
}

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, settings } = await resolveShell();

  return (
    <AppChrome
      user={user}
      lyricsEnabled={settings.lyricsEnabled}
      crossfadeSec={settings.crossfadeSec}
      preferAudio={settings.preferAudio}
      autoplaySimilar={settings.autoplaySimilar}
      volume={settings.volume}
    >
      {children}
    </AppChrome>
  );
}
