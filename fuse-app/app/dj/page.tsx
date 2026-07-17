import StagePlaceholder from "@/components/ui/stage-placeholder";

// DJ route (U4 shell). The two-deck console with a crossfader and honest per-source
// capabilities lands in U13/U14. Placeholder keeps the DJ tab a real navigation
// target. (The mini-player is intentionally hidden on this route — R4.)
export default function DjPage() {
  return (
    <StagePlaceholder
      stage="Stage E"
      title="The DJ console is coming"
      body="Two decks and a crossfader. Your own files get the full gear; YouTube and Spotify show honestly what they can and can't do."
    />
  );
}
