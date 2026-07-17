"use server";

// Server actions for the app shell (U4). Kept in one server module so client
// components (the profile sheet) can import them by reference and use them as
// <form action=...> handlers without pulling any auth runtime into the client bundle.

import { signOut } from "@/lib/auth";

// Sign the current user out and land them back on the sign-in page. This is a REAL,
// working control (the one live control in the U4 profile sheet). It calls Auth.js's
// signOut, which clears the database session. KEYLESS NOTE: with no DATABASE_URL /
// auth env set this cannot be reached in a real session anyway (there is nothing to
// sign out of); it is never invoked at build time, so a keyless build is unaffected.
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/api/auth/signin" });
}
