"use client";

// Profile sheet (U4 scaffold, extended in U9). Slides up from the avatar and holds
// all of the app's settings groups (R16): Account, Playback, Sources, Lyrics, About.
// There is deliberately NO audio-quality control (dropped from v1 per R16).
//
// HONESTY (R17): a control renders LIVE only when it does something real. Today that
// is Sign out (real server action) and Lyrics on/off (U9 — persists to the user's
// settings and shows/hides the Now Playing lyrics panel). Controls not yet wired
// (crossfade → U11, Spotify connect → U15) render DISABLED with a plain-English
// reason and a "soon" tag, read from PENDING_CONTROLS so the honesty list has one
// source of truth; when its owning unit wires a control it drops out of that list.

import { useEffect, useRef, useState } from "react";
import { PENDING_CONTROLS } from "@/lib/ui/shell";
import { signOutAction, setLyricsEnabledAction } from "@/lib/actions";
import type { ShellUser } from "@/components/ui/app-chrome";

type Props = {
  open: boolean;
  onClose: () => void;
  user: ShellUser | null;
  // The current Lyrics on/off value and a setter, owned by the shell so this toggle
  // and the Now Playing panel stay in sync (U9, R16).
  lyricsEnabled: boolean;
  onLyricsChange: (enabled: boolean) => void;
};

function initialOf(user: ShellUser | null): string {
  const source = user?.name || user?.email || "";
  return source.trim().charAt(0).toUpperCase() || "?";
}

function pendingFor(group: "Playback" | "Sources" | "Lyrics") {
  return PENDING_CONTROLS.filter((c) => c.group === group);
}

function PendingRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="setting-row disabled" aria-disabled="true">
      <div className="setting-main">
        <div className="setting-label">{label}</div>
        <div className="setting-reason">{reason}</div>
      </div>
      <span className="soon-tag">Soon</span>
    </div>
  );
}

export default function ProfileSheet({
  open,
  onClose,
  user,
  lyricsEnabled,
  onLyricsChange,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // While a persist is in flight the toggle is disabled so a rapid double-tap can't
  // race two writes. Optimistic: the UI flips immediately; if the server write fails
  // we revert so the control never lies about what was saved.
  const [saving, setSaving] = useState(false);

  async function toggleLyrics() {
    if (saving) return;
    const next = !lyricsEnabled;
    setSaving(true);
    onLyricsChange(next); // optimistic — the panel shows/hides instantly
    try {
      await setLyricsEnabledAction(next);
    } catch {
      onLyricsChange(!next); // revert on failure — honest state
    } finally {
      setSaving(false);
    }
  }

  // Close on Escape; move focus into the sheet when it opens (accessibility).
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={open ? "sheet-overlay open" : "sheet-overlay"}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={open ? "sheet open" : "sheet"}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        aria-hidden={!open}
      >
        <div className="sheet-handle" aria-hidden="true" />

        <div className="sheet-head">
          <div className="avatar" aria-hidden="true">
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- external Google avatar; next/image remote config is out of U4 scope
              <img src={user.image} alt="" referrerPolicy="no-referrer" />
            ) : (
              initialOf(user)
            )}
          </div>
          <div className="sheet-id">
            <div className="sheet-name">{user?.name ?? "Signed in"}</div>
            {user?.email ? <div className="sheet-email">{user.email}</div> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close settings"
            style={{ marginLeft: "auto" }}
          >
            ✕
          </button>
        </div>

        {/* Account — the one live group. Sign out is a real server action. */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Account</h3>
          <form action={signOutAction}>
            <button type="submit" className="signout-btn">
              Sign out
            </button>
          </form>
        </section>

        {/* Playback — crossfade length (wired in U11). */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Playback</h3>
          {pendingFor("Playback").map((c) => (
            <PendingRow key={c.id} label={c.label} reason={c.reason} />
          ))}
        </section>

        {/* Sources — the three music sources. YouTube is always on (built in);
            Spotify connect is wired in U15. */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Sources</h3>
          <div className="setting-row">
            <div className="setting-main">
              <div className="setting-label">YouTube</div>
              <div className="setting-reason">Always on — no sign-in needed</div>
            </div>
            <span className="badge yt">On</span>
          </div>
          {pendingFor("Sources").map((c) => (
            <PendingRow key={c.id} label={c.label} reason={c.reason} />
          ))}
        </section>

        {/* Lyrics — on/off. A REAL control (U9): it persists and shows/hides the
            Now Playing lyrics panel. */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Lyrics</h3>
          <div className="setting-row">
            <div className="setting-main">
              <div className="setting-label">Show lyrics</div>
              <div className="setting-reason">
                {lyricsEnabled
                  ? "Scrolling lyrics show on Now Playing"
                  : "Lyrics are hidden on Now Playing"}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={lyricsEnabled}
              aria-label="Show lyrics"
              className={lyricsEnabled ? "switch on" : "switch"}
              onClick={toggleLyrics}
              disabled={saving}
            >
              <span className="switch-knob" aria-hidden="true" />
            </button>
          </div>
        </section>

        {/* About — informational, not a control. */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">About</h3>
          <p className="about-line">
            Fuse blends your music — songs melt into each other across YouTube, Spotify,
            and your own files. It is being built in stages; every button you see does
            something real, and anything not ready yet says so plainly.
          </p>
        </section>
      </aside>
    </>
  );
}
