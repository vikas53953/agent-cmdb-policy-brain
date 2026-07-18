// Activity log — initial seed (U8 of R18; completed in U16).
//
// R18: the app records its OWN activity (playback events, errors) so failures can
// be diagnosed from evidence rather than guessed at. This is the first, in-memory
// seed — a bounded ring buffer any surface can write to and read back. U16 extends
// it (fuller coverage, and whatever persistence it needs).
//
// SECRETS NEVER TOUCH THE LOG (owner standing rule: logs record lengths, never
// values). The log stores plain, showable facts. For anything sensitive a caller
// records its LENGTH via `redactedLength()`, never the raw value. There are no
// secrets in playback events today; this guard keeps it that way as the log grows.
//
// Framework-free and DOM-free, so it runs in the browser, on the server, and in
// node unit tests alike — with or without any env vars set.

export type ActivityLevel = "info" | "error";

// A value safe to log in place of a sensitive string: its length, never its content.
export type RedactedLength = { redacted: true; length: number };

// Record the LENGTH of a sensitive string instead of the string itself. The only
// safe way to note "there was a value here" without ever writing the value.
export function redactedLength(value: string | null | undefined): RedactedLength {
  return { redacted: true, length: value ? value.length : 0 };
}

// A single logged fact. `detail` carries only non-sensitive scalars or the
// RedactedLength marker — never a raw secret.
export type ActivityDetail = Record<
  string,
  string | number | boolean | RedactedLength
>;

export type ActivityEvent = {
  at: number; // Date.now() when recorded
  level: ActivityLevel;
  type: string; // short machine tag, e.g. "play", "stall-retry", "error"
  message: string; // plain-English, safe to show to a user
  detail?: ActivityDetail;
};

export type ActivityInput = Omit<ActivityEvent, "at"> & { at?: number };

// Keep the log bounded so a long listening session can never grow memory without
// limit — oldest events fall off the front once the cap is reached.
const MAX_EVENTS = 200;
const buffer: ActivityEvent[] = [];

// Optional subscribers (a live diagnostics view in U16 can attach here). Kept tiny.
type ActivityListener = (event: ActivityEvent) => void;
const listeners = new Set<ActivityListener>();

export function logActivity(input: ActivityInput): ActivityEvent {
  const event: ActivityEvent = {
    at: input.at ?? Date.now(),
    level: input.level,
    type: input.type,
    message: input.message,
    ...(input.detail ? { detail: input.detail } : {}),
  };
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
  for (const listener of listeners) listener(event);
  return event;
}

// Convenience for the common error case (R18: errors say what went wrong).
export function logPlaybackError(
  message: string,
  detail?: ActivityDetail,
): ActivityEvent {
  return logActivity({
    level: "error",
    type: "error",
    message,
    ...(detail ? { detail } : {}),
  });
}

// A read-only snapshot of the log, oldest first. UI / diagnostics read this.
export function getActivity(): readonly ActivityEvent[] {
  return [...buffer];
}

// Subscribe to new events; returns an unsubscribe function.
export function onActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Clear the log (used by tests and the diagnostics reset control).
export function clearActivity(): void {
  buffer.length = 0;
}

// ── Diagnostics readers (U16 completion of R18) ────────────────────────────────
//
// R18 promises the app records its own activity so failures can be DIAGNOSED from
// evidence. U16 surfaces that: the diagnostics panel in the profile sheet reads the
// log through these helpers. Both are pure and secret-safe — a RedactedLength renders
// only as its length, never its value.

// True when a two-decimal-safe clock string can be built for `at`.
function clock(at: number): string {
  // Local HH:MM:SS — enough to line up events during a listening session. Guarded so a
  // bad timestamp degrades to "--:--:--" rather than throwing inside a render.
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Render one detail value for display. A RedactedLength becomes "[N chars]" — the
// value itself is NEVER produced, keeping the owner standing rule intact even in the UI.
function formatDetailValue(value: ActivityDetail[string]): string {
  if (typeof value === "object" && value !== null && "redacted" in value) {
    return `[${value.length} chars]`;
  }
  return String(value);
}

// A single plain-English line for the diagnostics view / a copyable log. Secret-safe.
export function formatActivityLine(event: ActivityEvent): string {
  const tag = event.level === "error" ? "ERROR" : "info";
  let line = `${clock(event.at)}  ${tag}  ${event.type}  ${event.message}`;
  if (event.detail) {
    const pairs = Object.entries(event.detail)
      .map(([k, v]) => `${k}=${formatDetailValue(v)}`)
      .join(", ");
    if (pairs) line += `  (${pairs})`;
  }
  return line;
}

// A one-glance summary for the diagnostics header (how much has happened, how much
// went wrong). Drives the "N events, M errors" line without exposing any content.
export function summarizeActivity(
  events: readonly ActivityEvent[] = getActivity(),
): { total: number; errors: number } {
  let errors = 0;
  for (const e of events) if (e.level === "error") errors += 1;
  return { total: events.length, errors };
}
