// Stable per-file fingerprint for keying a local track's saved cues (DJ-1).
//
// Hot cues persist "per user + track". A YouTube track has a natural id (the video id),
// but a LOCAL file has none — and the blueprint's promise is that files never leave the
// device, so we cannot hash server-side. This derives a short, stable id from the file's
// own bytes IN THE BROWSER: same file → same id (so its cues come back on reload / on
// another device where the user loads the same file), different file → different id.
//
// It is a lightweight content hash (FNV-1a over the size, name and a fixed set of byte
// samples), NOT a cryptographic digest — collisions across genuinely different files are
// astronomically unlikely for this use, and the cost is a few thousand byte reads rather
// than hashing an entire 50 MB buffer. Pure and deterministic, so it is unit-tested with
// plain byte arrays and no File/Blob.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// How many evenly-spaced bytes across the buffer to fold into the hash. Enough to
// separate different files cheaply without walking the whole (possibly huge) buffer.
const SAMPLE_COUNT = 4096;

function foldByte(hash: number, byte: number): number {
  // FNV-1a step, kept in 32-bit unsigned space via Math.imul.
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

// Hash raw file bytes plus their length into an 8-char hex id. Length is mixed in first
// so two files that share a sampled-byte pattern but differ in size never collide.
export function fingerprintBytes(bytes: Uint8Array): string {
  let hash = FNV_OFFSET >>> 0;
  const len = bytes.length;
  // Mix the length (4 bytes) so size alone changes the id.
  hash = foldByte(hash, len & 0xff);
  hash = foldByte(hash, (len >>> 8) & 0xff);
  hash = foldByte(hash, (len >>> 16) & 0xff);
  hash = foldByte(hash, (len >>> 24) & 0xff);

  if (len > 0) {
    const step = Math.max(1, Math.floor(len / SAMPLE_COUNT));
    for (let i = 0; i < len; i += step) hash = foldByte(hash, bytes[i]);
    // Always fold the final byte so a change at the very tail is caught.
    hash = foldByte(hash, bytes[len - 1]);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// The full local-track key used as a cue's `nativeId`: the content fingerprint, with the
// file name mixed in as a suffix so two files with identical bytes but different names
// (a rename, a copy) still read as the "same track" by content first — the name only
// disambiguates for display. Kept short and filesystem-agnostic.
export function localTrackKey(bytes: Uint8Array, fileName: string): string {
  const content = fingerprintBytes(bytes);
  // A tiny name hash keeps the key stable per (content,name) without embedding the raw
  // (possibly unicode / very long) filename into the id.
  let nameHash = FNV_OFFSET >>> 0;
  for (let i = 0; i < fileName.length; i++) nameHash = foldByte(nameHash, fileName.charCodeAt(i) & 0xff);
  return `${content}-${(nameHash >>> 0).toString(16).padStart(8, "0")}`;
}
