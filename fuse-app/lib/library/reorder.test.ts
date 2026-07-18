import { describe, it, expect } from "vitest";
import { moveItem, canMove } from "./reorder";

describe("moveItem", () => {
  it("moves an item up", () => {
    expect(moveItem(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
  });

  it("moves an item down", () => {
    expect(moveItem(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
  });

  it("is a no-op moving the first item up (returns an equal array)", () => {
    expect(moveItem(["a", "b", "c"], 0, "up")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op moving the last item down", () => {
    expect(moveItem(["a", "b", "c"], 2, "down")).toEqual(["a", "b", "c"]);
  });

  it("ignores an out-of-range index", () => {
    expect(moveItem(["a", "b"], 5, "up")).toEqual(["a", "b"]);
  });

  it("returns a new array (does not mutate the input)", () => {
    const input = ["a", "b", "c"];
    const out = moveItem(input, 1, "up");
    expect(out).not.toBe(input);
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("canMove", () => {
  it("first item cannot move up", () => {
    expect(canMove(3, 0, "up")).toBe(false);
    expect(canMove(3, 0, "down")).toBe(true);
  });

  it("last item cannot move down", () => {
    expect(canMove(3, 2, "down")).toBe(false);
    expect(canMove(3, 2, "up")).toBe(true);
  });

  it("a middle item can move both ways", () => {
    expect(canMove(3, 1, "up")).toBe(true);
    expect(canMove(3, 1, "down")).toBe(true);
  });
});
