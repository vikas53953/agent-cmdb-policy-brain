// Write status — the ONE way this app tells you whether a save actually happened.
//
// THE CLASS OF BUG THIS KILLS: before this file, every place that saved something
// (create a playlist, unlike a song, flip a setting, persist the volume) invented its
// own ending. Some swallowed the failure in an empty `catch`, some quietly put the old
// value back, some checked `if (ok)` and did nothing when it was not ok. The result was
// a screen that looked like the save worked when it had not — exactly the lie this app
// is not allowed to tell.
//
// The two halves live apart on purpose:
//   • THIS file is the pure core — no React, no DOM — so it runs in the plain node unit
//     tests. It turns the two DIFFERENT shapes of failure the app has (a thrown error,
//     and a "returned nothing" answer from a server action) into ONE settled outcome.
//   • components/ui/write-status.tsx wraps it in a hook + a small live-region pill that
//     announces the outcome to a screen reader and to the eye.
//
// WORDING RULE (owner's standing rule): plain words, active voice, say what to do next,
// never apologise. "Couldn't save — try again", not "An error occurred, sorry."

// How a message reads. Three tones cover everything the app needs:
//   ok      — it worked.
//   problem — it did NOT work; the user should do something.
//   note    — neither; a plain fact worth stating (e.g. "you cancelled that").
export type WriteTone = "ok" | "problem" | "note";

export type WriteMessage = { text: string; tone: WriteTone };

// How long a status pill stays on screen before it clears itself. Long enough to read a
// short line, short enough that it never becomes furniture.
export const WRITE_STATUS_MS = 3000;

// The settled result of one write. `ok` is the ONLY thing a caller needs to branch on —
// a throw and an empty answer both land here as `ok: false`.
// The success value is NonNullable<T> on purpose: the default success test already rules
// out null/undefined, so callers reading `result.value` never have to null-check a value
// the mechanism has just certified as present.
export type WriteResult<T> =
  | { ok: true; value: NonNullable<T> }
  | { ok: false; value: null };

// The default "did it work?" test, matching how this app's server actions answer:
// they return the saved thing, or `null` / `false` / `undefined` when the write did not
// land (not owned, no row, no database). `void` writes (which resolve to `undefined`)
// pass their own `succeeded` so an intentional empty answer is not read as a failure.
export function landed(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false;
}

// Run one write and settle it. Never throws — that is the whole point: the caller gets a
// plain yes/no and can be honest about it in one place instead of fifteen.
export async function runWrite<T>(
  op: () => Promise<T>,
  succeeded: (value: T) => boolean = landed,
): Promise<WriteResult<T>> {
  try {
    const value = await op();
    // The cast is safe for the default test (it rejects null/undefined). A caller that
    // supplies its own `succeeded` — e.g. `() => true` for an action that resolves with
    // nothing — is declaring that it will not read `value`.
    return succeeded(value)
      ? { ok: true, value: value as NonNullable<T> }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

// Build the line to show for a settled write. `ok` may be a plain string or a function of
// the saved value, so a site can say "Added to Road trip" without assembling text itself.
export function writeMessage<T>(
  result: WriteResult<T>,
  copy: { ok: string | ((value: NonNullable<T>) => string); failed: string },
): WriteMessage {
  if (result.ok) {
    const text = typeof copy.ok === "function" ? copy.ok(result.value) : copy.ok;
    return { text, tone: "ok" };
  }
  return { text: copy.failed, tone: "problem" };
}

// Two things happened and only one of them worked. Joining them keeps the honest half
// AND the failed half visible, instead of the success line hiding the failure.
export function bothWays(good: string, bad: string): WriteMessage {
  return { text: `${good}, but ${bad}`, tone: "problem" };
}

// The house failure line. `what` is a short verb phrase: couldNotSave("save the name").
export function couldNot(what: string): string {
  return `Couldn't ${what} — try again`;
}
