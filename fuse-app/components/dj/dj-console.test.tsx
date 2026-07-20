// Interaction tests for the DJ console's restore-vs-click collision.
//
// THE BUG CLASS THESE EXIST TO CATCH: restored state and an explicit user selection
// fighting each other. F-6 taught the console to come back on the source it was left on.
// The source picker, meanwhile, treated a tap on the CURRENT source as "turn it off" —
// harmless while the console always started sourceless, because your first tap could then
// only ever be a fresh pick. Together they broke: coming back and tapping "My Files" (the
// deck you are already on, the natural thing to do) tore the deck down instead, taking the
// loaded file, the cue pads and the restored video with it.
//
// So every assertion below is about ONE thing: re-asserting a selection you already have
// must change nothing. The deck stays open, and the console never hears "no source".

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EMPTY_DJ_SESSION, saveDjSession, type DjSession } from "@/lib/dj/session-state";

// The deck's real runtimes are stubbed: these tests are about what a click DOES to the
// deck's own state, not about Web Audio or the YouTube iframe, neither of which jsdom has.
vi.mock("@/lib/dj/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dj/engine")>()),
  createDjDeckEngine: () => ({
    available: true,
    dispose: vi.fn(),
    setCrossfade: vi.fn(),
    setRate: vi.fn(),
    setEq: vi.fn(),
    setEqKill: vi.fn(),
    setFilter: vi.fn(),
    setTrim: vi.fn(),
    setEcho: vi.fn(),
    position: () => 0,
    getLevel: () => 0,
  }),
}));

const youtubeLoad = vi.fn(async () => {});
vi.mock("@/lib/player/adapters/youtube", () => ({
  createYouTubeAdapter: () => ({
    mount: vi.fn(),
    unmount: vi.fn(),
    load: youtubeLoad,
    unload: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    setVolume: vi.fn(),
    setRate: vi.fn(),
    dispose: vi.fn(),
  }),
}));

vi.mock("@/lib/dj-actions", () => ({
  listCuesAction: vi.fn(async () => []),
  setCueAction: vi.fn(async () => true),
  deleteCueAction: vi.fn(async () => true),
}));

import DjConsole from "@/components/dj/dj-console";

// A console snapshot as F-6 would have written it — Deck A left on My Files holding a
// file, Deck B left on YouTube holding a video.
function restoredSession(): DjSession {
  return {
    ...EMPTY_DJ_SESSION,
    a: { ...EMPTY_DJ_SESSION.a, source: "local", localFileName: "late-night-set.wav" },
    b: { ...EMPTY_DJ_SESSION.b, source: "youtube", youtubeId: "abc123" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("F-6 — a restored deck and a tap on its own source must not fight", () => {
  test("tapping the source Deck A is already restored on keeps the file picker there", async () => {
    const user = userEvent.setup();
    saveDjSession(restoredSession());
    render(<DjConsole />);

    // The restore landed: Deck A is on My Files, so its file picker is on screen.
    const deckA = screen.getByTestId("deck-A");
    const localBtn = screen.getByTestId("deck-A-source-local");
    expect(localBtn).toHaveAttribute("aria-pressed", "true");
    expect(deckA.querySelector('input[type="file"]')).not.toBeNull();

    // The tap a returning DJ actually makes — on the source they can see is selected.
    await user.click(localBtn);

    // Nothing moved. This is the regression: it used to leave the deck sourceless, with
    // the file input (and every cue pad) gone from the DOM.
    expect(localBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("deck-A").querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.queryByText("Pick a source above to load this deck.")).toBeNull();
  });

  test("the same holds for a restored YouTube deck — its video is not thrown away", async () => {
    const user = userEvent.setup();
    saveDjSession(restoredSession());
    render(<DjConsole />);

    const youtubeBtn = screen.getByTestId("deck-B-source-youtube");
    expect(youtubeBtn).toHaveAttribute("aria-pressed", "true");
    // The restored video was handed to the player exactly once, on mount.
    expect(youtubeLoad).toHaveBeenCalledTimes(1);

    await user.click(youtubeBtn);

    expect(youtubeBtn).toHaveAttribute("aria-pressed", "true");
    // Still once: the tap neither reloaded it nor dropped it.
    expect(youtubeLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("deck-B").querySelector(".deck-yt-host, .deck-load")).not.toBeNull();
  });

  test("a genuinely DIFFERENT source still switches the deck (no over-correction)", async () => {
    const user = userEvent.setup();
    saveDjSession(restoredSession());
    render(<DjConsole />);

    await user.click(screen.getByTestId("deck-A-source-youtube"));

    expect(screen.getByTestId("deck-A-source-youtube")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("deck-A-source-local")).toHaveAttribute("aria-pressed", "false");
  });

  test("a fresh console still needs one tap to open a deck", async () => {
    const user = userEvent.setup();
    render(<DjConsole />);

    expect(screen.getByTestId("deck-A").querySelector('input[type="file"]')).toBeNull();
    await user.click(screen.getByTestId("deck-A-source-local"));
    expect(screen.getByTestId("deck-A").querySelector('input[type="file"]')).not.toBeNull();
  });
});
