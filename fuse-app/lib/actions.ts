"use server";

// Server actions for the app shell (U4). Kept in one server module so client
// components (the profile sheet) can import them by reference and use them as
// <form action=...> handlers without pulling any auth runtime into the client bundle.

import { cookies } from "next/headers";
import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/auth-session";
import { setLyricsEnabled, setCrossfadeSec, getCrossfadeSec } from "@/lib/repos/settings";

// Sign the current user out and land them back on the sign-in page. This is a REAL,
// working control (the one live control in the U4 profile sheet). It calls Auth.js's
// signOut, which clears the database session. KEYLESS NOTE: with no DATABASE_URL /
// auth env set this cannot be reached in a real session anyway (there is nothing to
// sign out of); it is never invoked at build time, so a keyless build is unaffected.
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/api/auth/signin" });
}

// Persist the Lyrics on/off setting for the signed-in user (U9, R16/R17). This is a
// REAL control — the profile-sheet toggle calls it and the value survives reload.
// requireUser scopes the write to the caller's own settings row; it can only ever be
// reached inside a real session, so a keyless build never invokes it. Returns the
// value written so the client can confirm/reconcile its optimistic state.
export async function setLyricsEnabledAction(enabled: boolean): Promise<boolean> {
  const user = await requireUser();
  await setLyricsEnabled(user.id, enabled);
  return enabled;
}

// Persist the crossfade length (seconds) for the signed-in user (U11, R3/R16/R17).
// This is a REAL control — the profile-sheet slider calls it and the blend engine
// reads the value, so the transition length genuinely changes and survives reload.
// The repo clamps to the honest 3..15s window; we return the STORED value so the
// client can reconcile its optimistic UI with what was actually saved. requireUser
// scopes the write to the caller's own settings row; a keyless build never invokes it.
export async function setCrossfadeSecAction(seconds: number): Promise<number> {
  const user = await requireUser();
  await setCrossfadeSec(user.id, seconds);
  return getCrossfadeSec(user.id);
}

// Disconnect Spotify (U15, R16). Clears the connection marker and the httpOnly token
// cookies set by the PKCE callback, so the Sources control honestly flips back to "not
// connected". A REAL control — it removes a real stored connection. Token VALUES are
// never read or logged here; the cookies are simply deleted. Reachable only inside a
// real session; a keyless build never invokes it.
export async function disconnectSpotifyAction(): Promise<void> {
  const jar = await cookies();
  jar.delete("sp_connected");
  jar.delete("sp_access_token");
  jar.delete("sp_refresh_token");
}
