// The Robot Test Door (E2E) — a secret-gated Credentials sign-in that lets an
// automated end-to-end robot (Playwright) sign in on REAL deployments WITHOUT Google.
// Google correctly blocks automated/headless sign-in, so a monitoring robot needs its
// own honest, tightly-scoped way in. This is that door.
//
// SECURITY MODEL (fails closed):
//   • The door DOES NOT EXIST unless E2E_TEST_SECRET is set to a strong value
//     (length >= ROBOT_SECRET_MIN_LENGTH). Unset or too-short => no Credentials
//     provider is registered at all, so there is nothing to attack.
//   • When the door is open, sign-in requires an EXACT match of the configured secret,
//     compared in constant time so a wrong guess leaks no timing signal.
//   • The secret is the ONLY thing that opens the door — not NODE_ENV — because the
//     door must work on production (that is the whole point: watch the live site). The
//     strength of the secret (48 random bytes, base64url) is the security boundary.
//
// This module is PURE and dependency-free (no next-auth, no prisma), so the gate can
// be unit-tested in node without standing up Auth.js or a database.

// A secret must be at least this long to open the door. 32 chars is the floor; the
// generated secret is 48 random bytes base64url (~64 chars). A short/blank value is
// treated as "no door" so a misconfiguration can never open a weak door.
export const ROBOT_SECRET_MIN_LENGTH = 32;

// The dedicated robot identity. A single, stable account the robot signs in as on any
// deployment — its likes/playlists are the robot's own, isolated from real users.
export const ROBOT_EMAIL = "robot@fuse.test";
export const ROBOT_NAME = "Fuse Test Robot";

// The Auth.js provider id the door registers under. The Playwright sign-in helper POSTs
// to /api/auth/callback/e2e-robot with this id.
export const ROBOT_PROVIDER_ID = "e2e-robot";

// The configured door secret, or null when the door is closed (unset / too short).
// Reading process.env by default keeps callers terse; tests pass an explicit value.
export function robotDoorSecret(
  env: string | undefined = process.env.E2E_TEST_SECRET,
): string | null {
  const secret = typeof env === "string" ? env : "";
  return secret.length >= ROBOT_SECRET_MIN_LENGTH ? secret : null;
}

// Is the door open on this deployment? True only when a strong secret is configured.
export function isRobotDoorEnabled(
  env: string | undefined = process.env.E2E_TEST_SECRET,
): boolean {
  return robotDoorSecret(env) !== null;
}

// Constant-time string equality. Avoids the early-exit that a naive === has, so a
// wrong-length or wrong-prefix guess takes the same time as any other wrong guess.
function timingSafeEqual(a: string, b: string): boolean {
  // Comparing lengths directly is fine to branch on (length is not the secret), but we
  // still fold it into the accumulator so the loop always runs a fixed number of steps.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Does `provided` (whatever the sign-in form sent) exactly match the configured door
// secret? Returns false when the door is closed (`expected` null) or the input is not
// a string — the honest, fail-closed default.
export function robotSecretMatches(
  provided: unknown,
  expected: string | null = robotDoorSecret(),
): boolean {
  if (!expected) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  return timingSafeEqual(provided, expected);
}
