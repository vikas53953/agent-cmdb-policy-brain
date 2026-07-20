import { describe, expect, it } from "vitest";
import { FOCUSABLE_SELECTOR, nextTrapFocus } from "@/components/ui/focus-trap";

describe("nextTrapFocus", () => {
  it("wraps forward off the last control to the first", () => {
    expect(nextTrapFocus(5, 4, false)).toBe(0);
  });

  it("wraps backward off the first control to the last", () => {
    expect(nextTrapFocus(5, 0, true)).toBe(4);
  });

  it("leaves interior moves to the browser", () => {
    expect(nextTrapFocus(5, 2, false)).toBeNull();
    expect(nextTrapFocus(5, 2, true)).toBeNull();
    expect(nextTrapFocus(5, 0, false)).toBeNull();
    expect(nextTrapFocus(5, 4, true)).toBeNull();
  });

  it("pulls focus back in when it has escaped behind the sheet", () => {
    // -1 means the focused element is not one of the dialog's controls — the exact
    // situation the old sheets left a keyboard user in.
    expect(nextTrapFocus(5, -1, false)).toBe(0);
    expect(nextTrapFocus(5, -1, true)).toBe(4);
  });

  it("does nothing when the sheet holds no focusable controls", () => {
    expect(nextTrapFocus(0, -1, false)).toBeNull();
    expect(nextTrapFocus(0, -1, true)).toBeNull();
  });

  it("treats a single control as its own wrap target", () => {
    expect(nextTrapFocus(1, 0, false)).toBe(0);
    expect(nextTrapFocus(1, 0, true)).toBe(0);
  });
});

describe("FOCUSABLE_SELECTOR", () => {
  it("skips disabled controls, so Tab matches the browser's own order", () => {
    // The queue's Move-up / Move-down buttons are really disabled at the ends of the
    // list; a trap that counted them would stall on an unfocusable element.
    expect(FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
    expect(FOCUSABLE_SELECTOR).toContain("input:not([disabled])");
  });

  it("skips programmatic-only tab stops", () => {
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });
});
