// Uploads pane (U10, R14 — the on-device promise).
//
// This is informational, not a control. It states the legal-safety line for the whole
// app: audio files you load for DJ mode stay on YOUR device and are NEVER uploaded to
// Fuse's servers — there is deliberately no upload endpoint for user media.
//
// The file picker + decoded playback is the Web Audio engine (U14), which lives on the
// DJ decks. This pane keeps the on-device promise visible in the Library and points to
// where files are actually loaded — it renders no control of its own, so there is
// nothing here that could pretend to work (R17).

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
        Open the DJ console and set a deck to My Files to pick a track from your device.
        It gets the full engine — EQ, loops, echo, scratch — and still never leaves your
        device.
      </p>
    </div>
  );
}
