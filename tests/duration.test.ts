import { describe, expect, it } from 'vitest';
import { parseDuration } from '../src/duration.js';

describe('duration parsing', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000]
  ])('parses %s into milliseconds', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '0h', '-1h', '1w', 'abc', '1.5h'])('rejects invalid duration %s', (input) => {
    expect(() => parseDuration(input)).toThrow('Duration must be a positive integer followed by s, m, h, or d.');
  });
});
