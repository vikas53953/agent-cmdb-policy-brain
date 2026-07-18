import DjConsole from "@/components/dj/dj-console";

// DJ route (U13, R12/R13/R17). The two-deck console with a crossfader and honest
// per-source capabilities. The mini-player is intentionally hidden on this route (R4)
// — the DJ page is its own full-surface player. The full Web Audio engine for local
// files (EQ/loops/FX/scratch on decoded audio) lands in U14; until then My Files is a
// disabled source option with a plain reason, and YouTube decks are fully live.
export default function DjPage() {
  return <DjConsole />;
}
