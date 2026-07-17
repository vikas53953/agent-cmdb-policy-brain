// The sign-in gate policy, isolated from the NextAuth runtime so it stays a pure,
// dependency-free function that unit tests can exercise without importing next-auth
// (which pulls in `next/server` and cannot load in the node test environment).
//
// Fuse is a PUBLIC app (R15): any Google account whose email Google asserts as
// verified may sign in. Everything else is rejected — fail closed; no other providers
// are configured.

export function signInGate(provider: string | undefined, emailVerified: unknown): boolean {
  if (provider === "google") {
    return emailVerified === true;
  }
  return false;
}
