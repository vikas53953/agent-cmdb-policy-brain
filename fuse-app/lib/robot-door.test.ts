import { describe, expect, it } from "vitest";
import {
  ROBOT_SECRET_MIN_LENGTH,
  isRobotDoorEnabled,
  robotDoorSecret,
  robotSecretMatches,
} from "@/lib/robot-door";

// A valid strong secret shape (>= 32 chars). The real one is 48 random bytes base64url.
const STRONG = "x".repeat(ROBOT_SECRET_MIN_LENGTH + 20);

describe("Robot Test Door — the door only exists with a strong secret (fails closed)", () => {
  it("is CLOSED when the env is unset (the default) — no door to attack", () => {
    expect(isRobotDoorEnabled(undefined)).toBe(false);
    expect(robotDoorSecret(undefined)).toBeNull();
  });

  it("is CLOSED when the secret is empty or too short", () => {
    expect(isRobotDoorEnabled("")).toBe(false);
    expect(isRobotDoorEnabled("short")).toBe(false);
    expect(isRobotDoorEnabled("x".repeat(ROBOT_SECRET_MIN_LENGTH - 1))).toBe(false);
    expect(robotDoorSecret("x".repeat(ROBOT_SECRET_MIN_LENGTH - 1))).toBeNull();
  });

  it("is OPEN only with a secret at or above the minimum length", () => {
    expect(isRobotDoorEnabled("x".repeat(ROBOT_SECRET_MIN_LENGTH))).toBe(true);
    expect(isRobotDoorEnabled(STRONG)).toBe(true);
    expect(robotDoorSecret(STRONG)).toBe(STRONG);
  });
});

describe("Robot Test Door — sign-in requires an exact secret match", () => {
  it("accepts the exact configured secret", () => {
    expect(robotSecretMatches(STRONG, STRONG)).toBe(true);
  });

  it("rejects a wrong secret (even same length)", () => {
    const wrong = "y".repeat(STRONG.length);
    expect(robotSecretMatches(wrong, STRONG)).toBe(false);
  });

  it("rejects a wrong-length secret (prefix of the real one)", () => {
    expect(robotSecretMatches(STRONG.slice(0, -1), STRONG)).toBe(false);
    expect(robotSecretMatches(STRONG + "z", STRONG)).toBe(false);
  });

  it("rejects when the door is closed, whatever is provided", () => {
    expect(robotSecretMatches(STRONG, null)).toBe(false);
    expect(robotSecretMatches(STRONG, robotDoorSecret(undefined))).toBe(false);
  });

  it("rejects non-string / empty input (fail closed)", () => {
    expect(robotSecretMatches(undefined, STRONG)).toBe(false);
    expect(robotSecretMatches(null, STRONG)).toBe(false);
    expect(robotSecretMatches(123, STRONG)).toBe(false);
    expect(robotSecretMatches("", STRONG)).toBe(false);
  });
});
