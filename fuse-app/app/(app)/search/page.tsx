import SearchBar from "@/components/search/searchbar";

// Search route (U6). As-you-type search across YouTube and Spotify with real cover
// art and source badges, backed by a server-side cache that protects the YouTube
// quota (KTD-8). YouTube results become playable once U7's adapter lands; Spotify
// results stay honestly disabled until U15 — the row itself decides (R17).
export default function SearchPage() {
  return (
    <div className="search-page">
      <h1 className="search-heading">Search</h1>
      <SearchBar />
    </div>
  );
}
