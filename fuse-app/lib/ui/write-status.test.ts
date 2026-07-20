// Unit tests for the shared "did the save work?" core (lib/ui/write-status.ts).
//
// These lock the one promise the whole mechanism rests on: BOTH shapes of failure this
// app produces — a thrown error and a server action that answers with nothing — settle
// as `ok: false`, so no caller can accidentally treat a failed write as a success.

import { describe, it, expect } from "vitest";
import {
  runWrite,
  writeMessage,
  landed,
  bothWays,
  couldNot,
  WRITE_STATUS_MS,
} from "./write-status";

describe("landed", () => {
  it("treats a real answer as a landed write", () => {
    expect(landed({ id: "p1" })).toBe(true);
    expect(landed(true)).toBe(true);
    expect(landed(0)).toBe(true);
    expect(landed("")).toBe(true);
  });

  it("treats an empty answer as a write that did not land", () => {
    expect(landed(null)).toBe(false);
    expect(landed(undefined)).toBe(false);
    expect(landed(false)).toBe(false);
  });
});

describe("runWrite", () => {
  it("settles a successful write with its value", async () => {
    const result = await runWrite(async () => ({ id: "p1" }));
    expect(result).toEqual({ ok: true, value: { id: "p1" } });
  });

  it("settles a thrown write as not ok, without throwing", async () => {
    const result = await runWrite(async () => {
      throw new Error("network down");
    });
    expect(result).toEqual({ ok: false, value: null });
  });

  it("settles a null answer as not ok — the silent failure this app kept missing", async () => {
    const result = await runWrite(async () => null);
    expect(result.ok).toBe(false);
  });

  it("settles a false answer as not ok", async () => {
    const result = await runWrite(async () => false);
    expect(result.ok).toBe(false);
  });

  it("honours a custom success test for writes that answer with nothing", async () => {
    const result = await runWrite<void>(async () => undefined, () => true);
    expect(result.ok).toBe(true);
  });

  it("still catches a throw when a custom success test is given", async () => {
    const result = await runWrite<void>(
      async () => {
        throw new Error("boom");
      },
      () => true,
    );
    expect(result.ok).toBe(false);
  });
});

describe("writeMessage", () => {
  it("uses the success line and the ok tone when the write landed", () => {
    const msg = writeMessage({ ok: true, value: 1 }, { ok: "Saved", failed: "nope" });
    expect(msg).toEqual({ text: "Saved", tone: "ok" });
  });

  it("builds the success line from the saved value when given a function", () => {
    const msg = writeMessage(
      { ok: true, value: { name: "Road trip" } },
      { ok: (p) => `Added to ${p.name}`, failed: "nope" },
    );
    expect(msg.text).toBe("Added to Road trip");
  });

  it("uses the failure line and the problem tone when the write did not land", () => {
    const msg = writeMessage(
      { ok: false, value: null },
      { ok: "Saved", failed: "Couldn't save — try again" },
    );
    expect(msg).toEqual({ text: "Couldn't save — try again", tone: "problem" });
  });
});

describe("wording helpers", () => {
  it("keeps both halves visible when one step worked and the next did not", () => {
    const msg = bothWays("Created Road trip", "the song wasn't added — try again");
    expect(msg.tone).toBe("problem");
    expect(msg.text).toContain("Created Road trip");
    expect(msg.text).toContain("wasn't added");
  });

  it("writes failure lines in plain words with a next step and no apology", () => {
    const line = couldNot("save the name");
    expect(line).toBe("Couldn't save the name — try again");
    expect(line.toLowerCase()).not.toContain("sorry");
    expect(line.toLowerCase()).not.toContain("error");
  });

  it("holds a status long enough to read", () => {
    expect(WRITE_STATUS_MS).toBeGreaterThanOrEqual(2000);
  });
});
