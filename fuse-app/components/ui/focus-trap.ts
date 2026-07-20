// The pure half of the dialog focus trap (see components/ui/sheet.tsx).
//
// Kept as a plain function over indexes, with no DOM in sight, so the wrap-around
// rules — the part that actually broke — can be proven by a unit test in the node
// test environment. The component keeps only the DOM plumbing: find the focusable
// controls, ask this function where Tab should land, move focus there.

// Everything the browser itself treats as tabbable inside a sheet. `:not([disabled])`
// matters: the queue's Move-up/Move-down buttons are genuinely disabled at the ends of
// the list, and Tab must skip them exactly as the browser would.
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Where a Tab press should send focus inside an open dialog.
 *
 * @param count       how many focusable controls the dialog holds
 * @param activeIndex index of the focused control, or -1 when focus is on the dialog
 *                    itself or has escaped behind it
 * @param shift       true for Shift+Tab
 * @returns the index to force focus to, or null to let the browser move normally
 *
 * Returning null for the interior is deliberate: a trap that re-implements every step
 * fights the browser's own tab order (and screen-reader virtual cursors). We only
 * intervene at the two edges and when focus is not in the dialog at all — which is the
 * bug being killed, where Tab walked out of the sheet and into the page behind it.
 */
export function nextTrapFocus(
  count: number,
  activeIndex: number,
  shift: boolean,
): number | null {
  if (count <= 0) return null;
  // Focus is not on one of the dialog's controls (it is on the dialog box itself, or it
  // has drifted out to the page behind). Pull it back to the near edge.
  if (activeIndex < 0) return shift ? count - 1 : 0;
  if (shift) return activeIndex === 0 ? count - 1 : null;
  return activeIndex === count - 1 ? 0 : null;
}
