import { describe, expect, it, vi } from "vitest";
import {
  SEEK_STEP_SEC,
  VOLUME_STEP,
  applyShortcut,
  resolveShortcut,
  type KeyContext,
  type ShortcutTarget,
} from "@/lib/player/shortcuts";

// A plain, non-typing, non-focused-control keystroke: the baseline every case varies from.
function ctx(overrides: Partial<KeyContext> = {}): KeyContext {
  return {
    key: " ",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    targetTag: "div",
    targetIsEditable: false,
    targetIsActivatable: false,
    ...overrides,
  };
}

describe("resolveShortcut — which keys the player claims", () => {
  it("maps the transport keys a music app is expected to answer", () => {
    expect(resolveShortcut(ctx({ key: " " }))).toBe("toggle-play");
    expect(resolveShortcut(ctx({ key: "Spacebar" }))).toBe("toggle-play");
    expect(resolveShortcut(ctx({ key: "ArrowLeft" }))).toBe("seek-back");
    expect(resolveShortcut(ctx({ key: "ArrowRight" }))).toBe("seek-forward");
    expect(resolveShortcut(ctx({ key: "ArrowUp" }))).toBe("volume-up");
    expect(resolveShortcut(ctx({ key: "ArrowDown" }))).toBe("volume-down");
    expect(resolveShortcut(ctx({ key: "m" }))).toBe("toggle-mute");
    expect(resolveShortcut(ctx({ key: "M" }))).toBe("toggle-mute");
  });

  it("ignores keys it has no meaning for", () => {
    expect(resolveShortcut(ctx({ key: "q" }))).toBeNull();
    expect(resolveShortcut(ctx({ key: "Escape" }))).toBeNull();
    expect(resolveShortcut(ctx({ key: "Tab" }))).toBeNull();
  });
});

describe("resolveShortcut — never while the user is typing", () => {
  it("leaves Space alone in the search box so it types a space", () => {
    expect(
      resolveShortcut(ctx({ key: " ", targetTag: "input", targetIsEditable: true })),
    ).toBeNull();
  });

  it("leaves the arrows alone in a text field so they move the caret", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(
        resolveShortcut(ctx({ key, targetTag: "textarea", targetIsEditable: true })),
      ).toBeNull();
    }
  });

  it("leaves `m` alone in a contentEditable region", () => {
    expect(
      resolveShortcut(ctx({ key: "m", targetTag: "div", targetIsEditable: true })),
    ).toBeNull();
  });

  it("leaves native inputs and selects to their own key handling", () => {
    // A range slider (volume / scrub) owns its arrows even though it is not "editable".
    expect(resolveShortcut(ctx({ key: "ArrowUp", targetTag: "input" }))).toBeNull();
    expect(resolveShortcut(ctx({ key: "ArrowDown", targetTag: "select" }))).toBeNull();
  });
});

describe("resolveShortcut — never hijacks a focused control", () => {
  it("gives Space to a focused button instead of double-firing play/pause", () => {
    expect(
      resolveShortcut(ctx({ key: " ", targetTag: "button", targetIsActivatable: true })),
    ).toBeNull();
  });

  it("gives Space to a custom role=button control too", () => {
    expect(
      resolveShortcut(ctx({ key: " ", targetTag: "div", targetIsActivatable: true })),
    ).toBeNull();
  });

  it("still seeks and changes volume while a button holds focus", () => {
    // The arrows have no native meaning on a button, so transport keeps them — this is
    // what makes the shortcuts usable right after a sheet moves focus to its close button.
    expect(
      resolveShortcut(ctx({ key: "ArrowRight", targetTag: "button", targetIsActivatable: true })),
    ).toBe("seek-forward");
    expect(
      resolveShortcut(ctx({ key: "m", targetTag: "button", targetIsActivatable: true })),
    ).toBe("toggle-mute");
  });
});

describe("resolveShortcut — leaves browser and OS chords alone", () => {
  it("ignores anything held with Ctrl, Cmd or Alt", () => {
    expect(resolveShortcut(ctx({ key: " ", ctrlKey: true }))).toBeNull();
    expect(resolveShortcut(ctx({ key: "ArrowLeft", metaKey: true }))).toBeNull();
    expect(resolveShortcut(ctx({ key: "ArrowRight", altKey: true }))).toBeNull();
    expect(resolveShortcut(ctx({ key: "m", ctrlKey: true }))).toBeNull();
  });

  it("leaves Shift+Space as the browser's page-up", () => {
    expect(resolveShortcut(ctx({ key: " ", shiftKey: true }))).toBeNull();
  });

  it("still allows a plain Shift with a non-activation key", () => {
    expect(resolveShortcut(ctx({ key: "ArrowRight", shiftKey: true }))).toBe("seek-forward");
  });
});

function fakeTarget(state: { positionSec: number; volume: number }) {
  const target = {
    toggle: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    getState: () => state,
  };
  // Proves the fake is a genuine stand-in for the store's shortcut surface: if the target
  // contract ever drifts, this assignment fails the typecheck rather than the test lying.
  const _contract: ShortcutTarget = target;
  void _contract;
  return target;
}

describe("applyShortcut — drives the existing store transport", () => {
  it("toggles playback rather than reimplementing play/pause", () => {
    const target = fakeTarget({ positionSec: 30, volume: 0.5 });
    applyShortcut("toggle-play", target);
    expect(target.toggle).toHaveBeenCalledTimes(1);
  });

  it("seeks by one named step in each direction", () => {
    const target = fakeTarget({ positionSec: 30, volume: 0.5 });
    applyShortcut("seek-forward", target);
    expect(target.seek).toHaveBeenCalledWith(30 + SEEK_STEP_SEC);
    applyShortcut("seek-back", target);
    expect(target.seek).toHaveBeenLastCalledWith(30 - SEEK_STEP_SEC);
  });

  it("never seeks before the start of the track", () => {
    const target = fakeTarget({ positionSec: 2, volume: 0.5 });
    applyShortcut("seek-back", target);
    expect(target.seek).toHaveBeenCalledWith(0);
  });

  it("steps volume and clamps to the 0..1 range", () => {
    const loud = fakeTarget({ positionSec: 0, volume: 0.98 });
    applyShortcut("volume-up", loud);
    expect(loud.setVolume).toHaveBeenCalledWith(1);

    const quiet = fakeTarget({ positionSec: 0, volume: 0.02 });
    applyShortcut("volume-down", quiet);
    expect(quiet.setVolume).toHaveBeenCalledWith(0);

    const mid = fakeTarget({ positionSec: 0, volume: 0.5 });
    applyShortcut("volume-up", mid);
    expect(mid.setVolume).toHaveBeenCalledWith(0.5 + VOLUME_STEP);
  });

  it("toggles mute through the store's own mute truth", () => {
    const target = fakeTarget({ positionSec: 0, volume: 0.5 });
    applyShortcut("toggle-mute", target);
    expect(target.toggleMute).toHaveBeenCalledTimes(1);
  });
});
