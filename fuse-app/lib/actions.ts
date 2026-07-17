"use server";

// Server actions for the app shell (U4). Kept in one server module so client
// components (the profile sheet) can import them by reference and use them as
// <form action=...> handlers without pulling any auth runtime into the client bundle.

import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/auth-session";
import { setLyricsEnabled } from "@/lib/repos/settings";

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
