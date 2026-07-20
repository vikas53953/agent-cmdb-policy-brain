"use client";

// Sheet — the ONE slide-up dialog primitive (a11y container contract).
//
// THE BUG THIS KILLS: every sheet in the app was hidden only by sliding it off the
// bottom of the screen (`transform: translate(-50%, 100%)`). Off-screen is not hidden:
// its ~30 buttons stayed in the tab order, so a keyboard user tabbing past the mini
// player fell into a stack of invisible controls with no visible focus ring. Worse, the
// panels also carried `aria-hidden="true"` while closed — focusable nodes inside an
// aria-hidden subtree is the axe `aria-hidden-focus` violation, and it left screen
// readers announcing controls that were not on screen. On top of that, no sheet ever
// moved focus IN when it opened (focus stayed stranded on the page behind), trapped Tab
// while open, or gave focus BACK to the trigger on close (it fell to <body>, so the next
// Tab restarted from the top of the page).
//
// WHY A PRIMITIVE AND NOT THREE PATCHES: Now Playing, the queue, and the profile sheet
// each had the same hole. Fixing them one at a time fixes three cases and leaves the
// class open — the fourth sheet someone adds next month ships the same bug. So the whole
// closed-dialog contract lives here, once:
//
//   • closed  → `inert` (out of the tab order AND out of the accessibility tree, which
//               is what `aria-hidden` was trying and failing to express) plus the
//               `data-sheet-closed` hook that globals.css uses to take it off the screen
//               for real, not just off to the side.
//   • open    → focus moves to the first real control, Tab and Shift+Tab wrap inside the
//               sheet instead of walking out the back, Escape closes.
//   • closing → focus returns to whatever opened the sheet.
//
// Anything built on <Sheet> gets all of that for free and cannot forget it.

import { useEffect, useRef, type ReactNode } from "react";
import { FOCUSABLE_SELECTOR, nextTrapFocus } from "@/components/ui/focus-trap";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  // Accessible name for the dialog, e.g. "Now playing".
  label: string;
  // Base class for the panel; " open" is appended while open, matching the existing
  // stylesheet (`.np` / `.np.open`).
  className: string;
  // Base class for the click-to-dismiss scrim behind the panel.
  overlayClassName: string;
  // The panel element. Each surface keeps the tag it already used, so no CSS moves.
  as?: "section" | "aside" | "div";
  children: ReactNode;
} & Omit<
  React.HTMLAttributes<HTMLElement>,
  "className" | "children" | "aria-label" | "aria-hidden" | "role"
>;

export default function Sheet({
  open,
  onClose,
  label,
  className,
  overlayClassName,
  as: Tag = "section",
  children,
  ...rest
}: SheetProps) {
  const panelRef = useRef<HTMLElement>(null);
  // Where focus came from, so closing hands it straight back to the mini-player button
  // (or avatar, or queue button) that opened this sheet.
  const returnToRef = useRef<HTMLElement | null>(null);
  // The close callbacks in the shell are inline arrows, so their identity changes on
  // every render. Reading them through a ref keeps this effect keyed on `open` alone —
  // otherwise it would tear down and re-run each render and yank focus back to the first
  // control while the user was mid-sheet.
  const onCloseRef = useRef(onClose);
  // Written in an effect, never during render — a ref write during render is exactly the
  // kind of thing that leaves a stale callback wired to a live key handler.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previous = document.activeElement;
    returnToRef.current = previous instanceof HTMLElement ? previous : null;

    // Move focus in. The first real control if there is one (the collapse/close button in
    // every current sheet), otherwise the panel itself — never leave focus behind the sheet.
    const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Re-read on every press: the queue's controls change as rows are reordered or
      // removed, so a snapshot taken at open time would trap against stale elements.
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const active = document.activeElement;
      const target = nextTrapFocus(
        items.length,
        active instanceof HTMLElement ? items.indexOf(active) : -1,
        e.shiftKey,
      );
      if (target === null) return; // interior move — let the browser do its normal thing
      e.preventDefault();
      items[target].focus();
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus only if we still own it. If something else has deliberately taken
      // focus (a sheet opening on top of this one, say), stealing it back would be worse
      // than the bug we are fixing.
      const active = document.activeElement;
      const ours = active === document.body || (active !== null && panel.contains(active));
      if (ours) returnToRef.current?.focus();
      returnToRef.current = null;
    };
  }, [open]);

  return (
    <>
      <div
        className={open ? `${overlayClassName} open` : overlayClassName}
        onClick={onClose}
        aria-hidden="true"
      />
      <Tag
        {...rest}
        ref={panelRef as React.Ref<HTMLElement & HTMLDivElement>}
        className={open ? `${className} open` : className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // `inert` is the whole point: a closed sheet's controls are unreachable by Tab,
        // by click, and by assistive tech. `aria-hidden` is kept for older engines, and is
        // now honest — with `inert` there is nothing focusable underneath it to violate
        // the aria-hidden-focus rule.
        inert={!open}
        aria-hidden={!open}
        data-sheet-closed={open ? "false" : "true"}
        // Focusable only as a fallback target when a sheet has no controls of its own.
        tabIndex={-1}
      >
        {children}
      </Tag>
    </>
  );
}
