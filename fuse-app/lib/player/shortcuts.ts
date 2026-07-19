// Global keyboard shortcuts — the keys a music app is expected to answer.
//
// THE GAP THIS CLOSES: the only keydown handlers in the app were Escape. Space did not
// play or pause, the arrows did not seek or change volume, and `m` did not mute. On a
// desktop that is the whole transport, and Fuse had none of it.
//
// WHY THE DECISION IS A PURE FUNCTION: the hard part of a global shortcut is not doing
// the action — it is knowing when NOT to. Space must type a space in the search box, must
// activate a focused button rather than firing twice, and must stay out of the way of
// browser chords like Ctrl+Space. Every one of those is a bug that only shows up in a real
// browser, which is exactly where it is expensive to catch. So the entire "should this
// keystroke be handled, and as what?" decision lives in `resolveShortcut` below — one
// pure function over a plain description of the event, unit-tested in node. The effect
// that binds the listener (components/player/keyboard-shortcuts.tsx) only describes the
// event and dispatches the verdict; it holds no judgement of its own. Adding a key later
// means adding a case here with a test, not re-deriving the guard conditions.
//
// COOPERATION WITH OPEN SHEETS: <Sheet> owns Escape and Tab inside a dialog and moves
// focus onto the sheet's first control when it opens. This handler claims neither of those
// keys, and its focused-control rule means the newly focused close button keeps Space for
// itself — so the two never fight over the same keystroke.

// How far the arrow keys move playback. One named constant so the keyboard, the OS media
// keys, and any future skip button all mean the same thing by "skip".
export const SEEK_STEP_SEC = 10;

// How much one arrow press moves the volume — ~20 presses across the full range, which is
// fine-grained enough to be useful and coarse enough to be quick.
export const VOLUME_STEP = 0.05;

export type ShortcutAction =
  | "toggle-play"
  | "seek-back"
  | "seek-forward"
  | "volume-up"
  | "volume-down"
  | "toggle-mute";

// A framework-free description of a keydown. The effect fills this in from the real
// KeyboardEvent; tests build it as a literal. Nothing here is a DOM node, which is what
// makes the predicate testable in a node environment.
export type KeyContext = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  // The tag name of the event target, lowercased ("input", "textarea", "div", ...).
  targetTag: string;
  // True when the target is a text field, a rich-text region, or anything else the user
  // could be typing into. Typing always wins over transport.
  targetIsEditable: boolean;
  // True when the target is a control the browser itself activates with Space or Enter —
  // a button, a link, a summary, a checkbox, anything with role="button". Letting a
  // global Space through here would fire the button AND toggle playback: the classic
  // double-fire where clicking Pause with the mouse then pressing Space plays again.
  targetIsActivatable: boolean;
};

// Keys the browser activates a focused control with. Only these need the activatable
// guard; an arrow press on a focused button has no native meaning, so seek/volume still
// work while a transport button holds focus.
const ACTIVATION_KEYS = new Set([" ", "Spacebar", "Enter"]);

const ACTION_BY_KEY: Record<string, ShortcutAction> = {
  " ": "toggle-play",
  // Older engines report the space bar as "Spacebar"; accepting both costs nothing.
  Spacebar: "toggle-play",
  ArrowLeft: "seek-back",
  ArrowRight: "seek-forward",
  ArrowUp: "volume-up",
  ArrowDown: "volume-down",
  m: "toggle-mute",
  M: "toggle-mute",
};

// THE ONE DECISION. Returns the action this keystroke should perform, or null when the
// app must keep its hands off and let the browser (or the focused control, or the text
// the user is typing) have the key.
export function resolveShortcut(context: KeyContext): ShortcutAction | null {
  // Modifier chords belong to the browser and the OS (Ctrl+M, Cmd+ArrowLeft = back, and
  // so on). Shift is deliberately NOT in this list: it is a plain typing modifier, and
  // hijacking Shift+Space would be as wrong as hijacking Space. It is handled by the
  // editable guard below instead.
  if (context.ctrlKey || context.metaKey || context.altKey) return null;

  // The user is typing. Space must produce a space in the search box, and the arrows must
  // move the caret — never the playhead.
  if (context.targetIsEditable) return null;

  // Native form controls own the arrows and Space entirely: a <select> changes option, a
  // range slider (the volume and scrub controls) moves its own value. Stealing those keys
  // would break the control the user is deliberately operating.
  if (context.targetTag === "select" || context.targetTag === "input") return null;

  const action = ACTION_BY_KEY[context.key];
  if (!action) return null;

  // A real button has focus: Space is its activation key, not ours. Without this, pressing
  // Space on the focused Pause button pauses (the button) and then plays again (us).
  if (context.targetIsActivatable && ACTIVATION_KEYS.has(context.key)) return null;

  // Shift+Space is "page up" in a scrolling document; leave it alone.
  if (context.shiftKey && ACTIVATION_KEYS.has(context.key)) return null;

  return action;
}

// The player surface the shortcut actions drive. As with Media Session, every action goes
// through existing store methods — a shortcut is another way to press the same buttons,
// never a second implementation of transport.
export type ShortcutTarget = {
  toggle(): unknown;
  seek(positionSec: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  getState(): { positionSec: number; volume: number };
};

// Apply a resolved action. Split from `resolveShortcut` so the "when" and the "what" can
// be read — and tested — independently.
export function applyShortcut(action: ShortcutAction, target: ShortcutTarget): void {
  const state = target.getState();
  switch (action) {
    case "toggle-play":
      void target.toggle();
      return;
    case "seek-back":
      target.seek(Math.max(0, state.positionSec - SEEK_STEP_SEC));
      return;
    case "seek-forward":
      // The store clamps to the track duration, so no ceiling is needed here.
      target.seek(state.positionSec + SEEK_STEP_SEC);
      return;
    case "volume-up":
      target.setVolume(Math.min(1, state.volume + VOLUME_STEP));
      return;
    case "volume-down":
      target.setVolume(Math.max(0, state.volume - VOLUME_STEP));
      return;
    case "toggle-mute":
      target.toggleMute();
  }
}
