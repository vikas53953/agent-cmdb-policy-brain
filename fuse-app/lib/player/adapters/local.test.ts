import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalAdapter,
  forgetLocalFile,
  provideLocalFile,
  registerLocalAdapter,
} from "@/lib/player/adapters/local";
import { createAdapterRegistry } from "@/lib/player/adapters";
import { SOURCE_CAPABILITIES } from "@/lib/player/capabilities";
import { clearActivity, getActivity } from "@/lib/activity-log";
import type { DjDeckEngine } from "@/lib/dj/engine";
import type { TrackRef } from "@/lib/repos/track";

function fakeEngine() {
  const calls: string[] = [];
  const engine: DjDeckEngine = {
    available: true,
    hasTrack: false,
    playing: false,
    resume: vi.fn(async () => {
      calls.push("resume");
    }),
    loadFile: vi.fn(async () => {
      calls.push("loadFile");
    }),
    loadArrayBuffer: vi.fn(async () => {}),
    play: vi.fn(() => {
      calls.push("play");
    }),
    pause: vi.fn(() => {
      calls.push("pause");
    }),
    toggle: vi.fn(() => false),
    seek: vi.fn(() => {
      calls.push("seek");
    }),
    setEq: vi.fn(),
    setRate: vi.fn(() => {
      calls.push("setRate");
    }),
    setCrossfade: vi.fn(() => {
      calls.push("setCrossfade");
    }),
    setLoop: vi.fn(),
    setEcho: vi.fn(),
    scratch: vi.fn(),
    endScratch: vi.fn(),
    position: vi.fn(() => 0),
    duration: vi.fn(() => 0),
    dispose: vi.fn(() => {
      calls.push("dispose");
    }),
  };
  return { engine, calls };
}

const FAKE_FILE = { name: "song.mp3" } as unknown as File;

function localTrack(nativeId: string): TrackRef {
  return {
    source: "local",
    nativeId,
    title: "A local track",
    artist: null,
    artUrl: null,
    durationSec: null,
  };
}

describe("createLocalAdapter", () => {
  beforeEach(() => {
    clearActivity();
  });

  it("declares the local capability column", () => {
    const { engine } = fakeEngine();
    const adapter = createLocalAdapter({ engine, files: new Map() });
    expect(adapter.source).toBe("local");
    expect(adapter.capabilities).toBe(SOURCE_CAPABILITIES.local);
  });

  it("decodes a provided file on a user gesture (resume before load)", async () => {
    const { engine, calls } = fakeEngine();
    const files = new Map<string, File>([["file-1", FAKE_FILE]]);
    const adapter = createLocalAdapter({ engine, files });
    await adapter.load(localTrack("file-1"));
    expect(calls).toEqual(["resume", "loadFile"]);
  });

  it("fails honestly (logs, no decode) when the file is not on this device", async () => {
    const { engine } = fakeEngine();
    const adapter = createLocalAdapter({ engine, files: new Map() });
    await adapter.load(localTrack("missing"));
    expect(engine.loadFile).not.toHaveBeenCalled();
    const errors = getActivity().filter((e) => e.level === "error");
    expect(errors.length).toBe(1);
    expect(errors[0].message).toMatch(/isn't loaded/i);
  });

  it("delegates transport to the engine (crossfade for volume)", async () => {
    const { engine } = fakeEngine();
    const adapter = createLocalAdapter({ engine, files: new Map() });
    adapter.pause();
    adapter.seek(12);
    adapter.setVolume(0.4);
    adapter.setRate(1.5);
    adapter.unload();
    expect(engine.pause).toHaveBeenCalled();
    expect(engine.seek).toHaveBeenCalledWith(12);
    expect(engine.setCrossfade).toHaveBeenCalledWith(0.4);
    expect(engine.setRate).toHaveBeenCalledWith(1.5);
    expect(engine.dispose).toHaveBeenCalled();
  });
});

describe("session file store", () => {
  it("provides and forgets a file by nativeId", async () => {
    const nativeId = provideLocalFile("track-x", FAKE_FILE);
    expect(nativeId).toBe("track-x");

    const { engine, calls } = fakeEngine();
    // Uses the module-level default session map.
    const adapter = createLocalAdapter({ engine });
    await adapter.load(localTrack("track-x"));
    expect(calls).toContain("loadFile");

    forgetLocalFile("track-x");
    clearActivity();
    const { engine: engine2 } = fakeEngine();
    const adapter2 = createLocalAdapter({ engine: engine2 });
    await adapter2.load(localTrack("track-x"));
    expect(engine2.loadFile).not.toHaveBeenCalled();
  });
});

describe("registerLocalAdapter", () => {
  it("registers a local adapter into a given registry (opt-in, not at import)", () => {
    const registry = createAdapterRegistry();
    expect(registry.get("local")).toBeUndefined();
    const { engine } = fakeEngine();
    const adapter = registerLocalAdapter(registry, { engine, files: new Map() });
    expect(registry.get("local")).toBe(adapter);
  });
});
