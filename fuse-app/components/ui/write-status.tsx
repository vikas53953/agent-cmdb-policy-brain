"use client";

// Write status — the React half. See lib/ui/write-status.ts for why this exists.
//
// `useWriteStatus()` gives a component one honest ending for every save it makes:
// run the write through `report(...)`, and the outcome is announced in a live region
// that a screen reader reads out and that clears itself a few seconds later. The site
// keeps only what is truly its own — what to put back on screen if the save failed.
//
// Generalised from the two places the app already did this right: the `flash()` +
// role="status" pill in add-to-playlist.tsx and the honest settled-outcome render in
// searchbar.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  runWrite,
  writeMessage,
  WRITE_STATUS_MS,
  type WriteMessage,
  type WriteResult,
} from "@/lib/ui/write-status";

export type ReportOptions<T> = {
  // What to say when it worked. A function receives the saved value.
  ok: string | ((value: NonNullable<T>) => string);
  // What to say when it did not. Plain words, and what to do next.
  failed: string;
  // Optional: this write's own test for "it landed" (defaults to "answered with
  // something"). A write that resolves to nothing on success passes `() => true`.
  succeeded?: (value: T) => boolean;
  // Optional: put the screen back the way it was after a failed optimistic change.
  onFail?: () => void;
  // Optional: apply the saved value the server handed back.
  onOk?: (value: NonNullable<T>) => void;
};

export function useWriteStatus(holdMs: number = WRITE_STATUS_MS) {
  const [message, setMessage] = useState<WriteMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Show one line and clear it after the hold. Repeated calls replace the line rather
  // than stacking, so the pill always shows the most recent truth.
  const say = useCallback(
    (next: WriteMessage) => {
      if (!alive.current) return;
      setMessage(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (alive.current) setMessage(null);
      }, holdMs);
    },
    [holdMs],
  );

  // Run a write, announce the honest outcome, and hand the result back so the caller
  // can do its own repair work. Never throws.
  const report = useCallback(
    async <T,>(op: () => Promise<T>, opts: ReportOptions<T>): Promise<WriteResult<T>> => {
      const result = await runWrite(op, opts.succeeded);
      if (result.ok) opts.onOk?.(result.value);
      else opts.onFail?.();
      say(writeMessage(result, { ok: opts.ok, failed: opts.failed }));
      return result;
    },
    [say],
  );

  return { message, say, report };
}

// The pill itself. role="status" + aria-live="polite" means the line is announced the
// moment it appears without stealing focus. Renders nothing when there is nothing to say.
export default function WriteStatus({
  message,
  className,
  testId,
}: {
  message: WriteMessage | null;
  // Lets a site place the pill in its own layout (e.g. the anchored add-to-playlist one).
  className?: string;
  testId?: string;
}) {
  if (!message) return null;
  return (
    <span
      className={`write-status ${message.tone}${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      data-testid={testId ?? "write-status"}
      data-tone={message.tone}
    >
      {message.text}
    </span>
  );
}
