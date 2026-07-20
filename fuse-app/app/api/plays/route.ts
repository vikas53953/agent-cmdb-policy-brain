// Play-recording API route (U12, R11/R18, KTD-4).
//
// The player (client) POSTs here the moment a track actually starts playing. Recording
// a play feeds two things: the user's own "recently played" row and the anonymous
// aggregate that trending graduates into (KTD-4). It is a side effect of listening —
// it must NEVER surface an error to the listener or block playback, so every failure
// path answers honestly with { ok: false } instead of throwing.
//
// KEYLESS / DB-LESS SAFE: with no DATABASE_URL the write degrades to a silent
// non-record rather than 500-ing; nothing here needs a secret to be set.

import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-session";
import { recordPlay } from "@/lib/repos/plays";
import { isTrackSource } from "@/lib/repos/track";
import { logActivity } from "@/lib/activity-log";

// Prisma/Neon writes need the Node runtime.
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getUser();
    // A play is owned data — with no signed-in user there is nothing to attribute it
    // to. Honest, not an error the UI shows.
    if (!user) return NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body.source !== "string" ||
      !isTrackSource(body.source) ||
      typeof body.nativeId !== "string" ||
      body.nativeId === "" ||
      typeof body.title !== "string" ||
      body.title === ""
    ) {
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
    }

    await recordPlay(user.id, {
      source: body.source,
      nativeId: body.nativeId,
      title: body.title,
      artist: typeof body.artist === "string" ? body.artist : null,
      artUrl: typeof body.artUrl === "string" ? body.artUrl : null,
    });
    return NextResponse.json({ ok: true });
  } catch {
    // Best-effort: a failed record never breaks listening. No DB / keyless lands here.
    // AUDIT 28: it used to vanish into a bare `catch {}`, so a play that never recorded
    // left no trace to diagnose from (R18). Logged as a plain fact — no secret, no
    // request body, nothing but what happened.
    logActivity({
      level: "error",
      type: "plays-api",
      message: "Couldn't record a play",
    });
    return NextResponse.json({ ok: false, reason: "unavailable" });
  }
}
