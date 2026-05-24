const durationPattern = /^([1-9]\d*)([smhd])$/;

const unitMs: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

export function parseDuration(ttl: string): number {
  const match = durationPattern.exec(ttl);
  if (!match) {
    throw new Error('Duration must be a positive integer followed by s, m, h, or d.');
  }

  return Number(match[1]) * unitMs[match[2]];
}
