"use client";

// Profile sheet — SCAFFOLD (U4). Slides up from the avatar and holds all of the
// app's settings groups (R16): Account, Playback, Sources, Lyrics, About. There is
// deliberately NO audio-quality control (dropped from v1 per R16).
//
// HONESTY (R17): the only control here that works today is Sign out — it is a real
// server action. Every other control is not yet wired (crossfade → U11, lyrics →
// U9, Spotify connect → U15), so each renders DISABLED with a plain-English reason
// and a "soon" tag. They are read from PENDING_CONTROLS so the honesty list has one
// source of truth; when an owning unit wires a control it drops out of that list and
// this sheet renders it live instead.

import { useEffect, useRef } from "react";
import { PENDING_CONTROLS } from "@/lib/ui/shell";
import { signOutAction } from "@/lib/actions";
import type { ShellUser } from "@/components/ui/app-chrome";

type Props = {
  open: boolean;
  onClose: () => void;
  user: ShellUser | null;
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

export default function ProfileSheet({ open, onClose, user }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

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

        {/* Lyrics — on/off (wired in U9). */}
        <section className="sheet-group">
          <h3 className="sheet-group-title">Lyrics</h3>
          {pendingFor("Lyrics").map((c) => (
            <PendingRow key={c.id} label={c.label} reason={c.reason} />
          ))}
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
