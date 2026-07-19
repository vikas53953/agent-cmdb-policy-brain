import SearchBar from "@/components/search/searchbar";
import { getUser } from "@/lib/auth-session";

// Search route (U6). As-you-type search across YouTube and Spotify with real cover
// art and source badges, backed by a server-side cache that protects the YouTube
// quota (KTD-8). YouTube results become playable once U7's adapter lands; Spotify
// results stay honestly disabled until U15 — the row itself decides (R17).
//
// Wave 1 adds recent searches + result filters. Recent searches are per-user on a shared
// browser, so we hand the SearchBar a stable user key (the signed-in id, or "anon") to
// namespace them. Guarded so a keyless / signed-out environment degrades to "anon".
export const dynamic = "force-dynamic";

async function resolveUserKey(): Promise<string> {
  try {
    const user = await getUser();
    return user?.id ?? "anon";
  } catch {
    return "anon";
  }
}

export default async function SearchPage() {
  const userKey = await resolveUserKey();
  return (
    <div className="search-page">
      <h1 className="search-heading">Search</h1>
      <SearchBar userKey={userKey} />
    </div>
  );
}
