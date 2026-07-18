// Format a duration in seconds as m:ss (or h:mm:ss past an hour) for the scrub bar
// and Now Playing readouts (U8). Pure and framework-free so it is unit-tested in
// node and shared by every surface that shows a clock. Guards NaN / negative /
// Infinity (an unknown duration reports 0 as the player warms up) to "0:00".
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const ss = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    const mm = minutes.toString().padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
