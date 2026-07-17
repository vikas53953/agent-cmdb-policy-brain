import StagePlaceholder from "@/components/ui/stage-placeholder";

// Search route (U4 shell). The real as-you-type search across YouTube and Spotify
// with cached results lands in U6. This placeholder keeps the Search tab a real,
// working navigation target in the meantime.
export default function SearchPage() {
  return (
    <StagePlaceholder
      stage="Stage B"
      title="Search is on the way"
      body="Soon you'll type here and see songs from YouTube and Spotify with their real covers, then tap one to play instantly."
    />
  );
}
