import StagePlaceholder from "@/components/ui/stage-placeholder";

// Library route (U4 shell). Likes, playlists, and the on-device uploads pane land in
// U10. Placeholder keeps the Library tab a real navigation target until then.
export default function LibraryPage() {
  return (
    <StagePlaceholder
      stage="Stage C"
      title="Your library is coming"
      body="Your liked songs and playlists — mixing tracks from any source — will live here and follow you to any device you sign into."
    />
  );
}
