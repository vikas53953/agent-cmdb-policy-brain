// Uploads pane (U10, R14 — the on-device promise).
//
// This is informational, not a control. It states the legal-safety line for the whole
// app: audio files you load for DJ mode stay on YOUR device and are NEVER uploaded to
// Fuse's servers — there is deliberately no upload endpoint for user media.
//
// The actual file picker + decoded playback is the local-file adapter and Web Audio
// engine (U14). Rather than show a file button that cannot yet play anything (a dead
// control — R17), this pane honestly says that loading files lands with DJ local-file
// support, keeping the on-device promise visible where files will be loaded.

export default function UploadsPane() {
  return (
    <div className="uploads">
      <div className="uploads-promise">
        <h2 className="uploads-title">Your files stay on your device</h2>
        <p className="uploads-body">
          Audio you load for DJ mode is read straight from your device and used right
          here in your browser. Fuse never uploads or stores your music files — there
          is no server to send them to.
        </p>
      </div>
      <p className="uploads-note">
        Loading your own files turns on with DJ local-file support. When it arrives,
        you&apos;ll pick files here and they&apos;ll be ready for the DJ decks — still
        never leaving your device.
      </p>
    </div>
  );
}
