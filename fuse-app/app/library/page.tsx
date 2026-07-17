// Library route (U10, R8/R9/R14). Server component: it resolves the signed-in user
// and reads their liked tracks and playlists through the repos layer (ownerId-scoped),
// then hands plain DTOs to the client Library screen.
//
// KEYLESS / SIGNED-OUT SAFETY: the whole app is auth-gated by the proxy, but this read
// is still guarded — with no DATABASE_URL / no session it degrades to empty lists
// instead of throwing, and because the layout is force-dynamic this never runs at
// build time. So `next build` with no env is unaffected, and a real signed-in session
// gets the user's actual data.

import { getUser } from "@/lib/auth-session";
import { listLikes } from "@/lib/repos/likes";
import { listPlaylists } from "@/lib/repos/playlists";
import { toLikedTrackDTO, toPlaylistDTO, type LikedTrackDTO, type PlaylistDTO } from "@/lib/library/dto";
import LibraryScreen from "@/components/library/library-screen";

async function loadLibrary(): Promise<{ likes: LikedTrackDTO[]; playlists: PlaylistDTO[] }> {
  try {
    const user = await getUser();
    if (!user) return { likes: [], playlists: [] };
    const [likeRows, playlistRows] = await Promise.all([
      listLikes(user.id),
      listPlaylists(user.id),
    ]);
    return {
      likes: likeRows.map(toLikedTrackDTO),
      playlists: playlistRows.map(toPlaylistDTO),
    };
  } catch {
    // No DB / keyless — degrade to an empty (but fully functional) library shell.
    return { likes: [], playlists: [] };
  }
}

export default async function LibraryPage() {
  const { likes, playlists } = await loadLibrary();
  return <LibraryScreen likes={likes} playlists={playlists} />;
}
