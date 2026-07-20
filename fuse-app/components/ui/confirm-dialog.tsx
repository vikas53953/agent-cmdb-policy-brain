"use client";

// ASK BEFORE YOU DESTROY — the one way this app checks before something is gone.
//
// THE CLASS OF BUG THIS KILLS: deleting a playlist happened the instant the trash icon
// was tapped. No question, no undo, no message. Combined with a control that sometimes
// needed a second tap, a listener could lose a playlist they had spent months building
// to a stray double-tap and never be told it happened.
//
// This is deliberately a SHARED component rather than a dialog glued into the playlist
// card, because "delete" is not the only thing in this app a user can lose. Anything
// that removes something they made should ask with this, so the question always looks
// and behaves the same.
//
// WHY NOT window.confirm: the app is driven by a browser-automation test suite, and a
// native dialog blocks the page and the runner with it. This is a real in-app dialog —
// it also lets the question use the app's own voice instead of the browser's.
//
// WORDING RULE (owner's standing rule, same as write-status.ts): plain words. Name the
// thing being deleted, and label the buttons with what they DO — "Delete playlist" and
// "Keep it", never "OK" and "Cancel", which make the user work out which is which.

import { useEffect, useRef } from "react";

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep it",
  onConfirm,
  onCancel,
  busy = false,
  testId = "confirm-dialog",
}: {
  open: boolean;
  // The question itself, e.g. Delete "Road trip"? Always names the thing.
  title: string;
  // One line on what actually happens. Optional — a clear question often needs nothing.
  body?: string;
  // What the destructive button says it will do.
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  // True while the confirmed action is running, so it cannot be fired twice.
  busy?: boolean;
  testId?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Escape backs out, and focus lands on the SAFE choice when the dialog opens — so a
  // stray Enter keeps the playlist rather than deleting it.
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <>
      <div className="confirm-overlay open" onClick={onCancel} aria-hidden="true" />
      <div
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
      >
        <p className="confirm-title">{title}</p>
        {body ? <p className="confirm-body">{body}</p> : null}
        <div className="confirm-actions">
          <button
            type="button"
            className="confirm-keep"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            data-testid="confirm-cancel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-go"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-accept"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
