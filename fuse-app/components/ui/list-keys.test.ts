import { describe, expect, it } from "vitest";
import { occurrenceKeys } from "@/components/ui/list-keys";

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
};

describe("occurrenceKeys", () => {
  it("passes unique identities straight through", () => {
    expect(occurrenceKeys(["yt:a", "yt:b", "sp:c"])).toEqual(["yt:a", "yt:b", "sp:c"]);
  });

  it("keeps repeated identities distinct", () => {
    expect(occurrenceKeys(["yt:a", "yt:b", "yt:a", "yt:a"])).toEqual([
      "yt:a",
      "yt:b",
      "yt:a#1",
      "yt:a#2",
    ]);
  });

  it("gives every row the same key after a reorder — the actual bug", () => {
    const queue = ["yt:a", "yt:b", "yt:c", "yt:d"];
    const before = new Map(queue.map((id, i) => [id, occurrenceKeys(queue)[i]]));

    // Tap "Move up" on the last row.
    const after = move(queue, 3, 2);
    const afterKeys = occurrenceKeys(after);

    for (const [i, id] of after.entries()) {
      expect(afterKeys[i]).toBe(before.get(id));
    }
  });

  it("survives a reorder even when the queue holds the same song twice", () => {
    const queue = ["yt:a", "yt:dup", "yt:c", "yt:dup"];
    const keysBefore = occurrenceKeys(queue);
    const keysAfter = occurrenceKeys(move(queue, 0, 2));

    // Same set of keys, so React moves rows instead of rebuilding them.
    expect([...keysAfter].sort()).toEqual([...keysBefore].sort());
    // And every key is still unique.
    expect(new Set(keysAfter).size).toBe(keysAfter.length);
  });

  it("never emits a duplicate key", () => {
    const keys = occurrenceKeys(["x", "x", "x", "y", "x", "y"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("handles an empty list", () => {
    expect(occurrenceKeys([])).toEqual([]);
  });
});
