// Pure, framework-free configuration for the app shell (U4). Kept out of the
// React components so the structural rules — which tabs exist, which routes show
// the mini-player, and which profile-sheet controls are NOT yet wired — are
// data that unit tests (shell.test.ts) can assert against without a DOM.
//
// The honesty rule (R17) lives here as data: PENDING_CONTROLS is the single list
// of settings-sheet controls that do not work yet. The profile sheet renders each
// of these DISABLED with its plain-English reason. When an owning unit wires a
// control for real, it removes that entry — so the list can never silently drift
// into a fake, enabled-but-dead control.

export type TabDef = {
  href: string;
  label: string;
  icon: "home" | "search" | "dj" | "library";
};

// Bottom tab bar order (prototype: Home, Search, DJ, Library).
export const TABS: readonly TabDef[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/dj", label: "DJ", icon: "dj" },
  { href: "/library", label: "Library", icon: "library" },
];

// Is `href` the active tab for the current pathname? Home ("/") matches only
// exactly; every other tab matches its route and any nested route under it.
export function isActiveTab(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// R4: the persistent mini-player is visible on Home, Search, and Library — but
// NOT on the DJ console (the DJ page is its own full-surface player). Anything
// that is not the DJ route shows the mini-player.
export function showsMiniPlayer(pathname: string): boolean {
  return !(pathname === "/dj" || pathname.startsWith("/dj/"));
}

// A profile-sheet control that is intentionally NOT wired in this unit. Rendered
// disabled with `reason`; `wiredIn` names the unit that will make it real. Keeping
// `wiredIn` here documents the honest plan in one place (and is asserted in tests).
export type PendingControl = {
  id: string;
  group: "Playback" | "Sources" | "Lyrics";
  label: string;
  reason: string;
  wiredIn: string;
};

// The controls the profile sheet shows as "coming later". Each has a plain-English
// reason a non-technical owner can read. (Audio-quality is deliberately absent —
// it was dropped from v1 per R16, so it is not a pending control, it is gone.)
export const PENDING_CONTROLS: readonly PendingControl[] = [
  // Crossfade length graduated to a REAL control in U11 (the profile-sheet slider
  // persists it and the blend engine reads it), so it is no longer pending.
  {
    id: "spotify",
    group: "Sources",
    label: "Connect Spotify",
    reason: "Turns on when Spotify support arrives",
    wiredIn: "U15",
  },
];

// Source badge display metadata (prototype .src.yt/.sp/.mp3). One definition the
// search results, mini-player, and library rows all read from.
export type SourceBadge = { className: string; label: string };
export const SOURCE_BADGES: Record<string, SourceBadge> = {
  youtube: { className: "yt", label: "YouTube" },
  spotify: { className: "sp", label: "Spotify" },
  local: { className: "mp3", label: "My Files" },
};
