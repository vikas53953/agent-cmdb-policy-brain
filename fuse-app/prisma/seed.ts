// Starter picks seed (KTD-4). Home shows this short ordered list as "Starter picks"
// — never as "Trending" — until enough real anonymous play data accumulates for true
// aggregate trending to graduate in (U12, chooseTrending()). Run with
// `npm run db:seed` against a database that has the schema applied.
//
// KEYLESS-SAFE: this script only runs when explicitly invoked (never during build or
// typecheck), so it may assume DATABASE_URL is set. It fails loudly with an honest
// message if it isn't, rather than silently writing nowhere.
//
// HONESTY (R17): these are well-known songs picked to give a brand-new account
// something real to play. They are NOT a measurement of what is popular, so the row
// they fill must never claim to be. The label lives in lib/home/recommend.ts
// (trendingRowTitle) and only says "Trending" once real play counts back it.
//
// Cover art: YouTube's keyless thumbnail CDN (i.ytimg.com), which the app's CSP
// already allows under img-src (lib/security-headers.ts). Every row therefore renders
// real artwork, never a plain grey box (R5).
//
// The video ids are public YouTube ids — no key or credential appears here.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Keyless, CSP-allowed cover art for a YouTube video id.
function ytArt(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

const STARTER_PICKS = [
  { rank: 0, source: "youtube", nativeId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley" },
  { rank: 1, source: "youtube", nativeId: "9bZkp7q19f0", title: "Gangnam Style", artist: "PSY" },
  { rank: 2, source: "youtube", nativeId: "kJQP7kiw5Fk", title: "Despacito", artist: "Luis Fonsi" },
  { rank: 3, source: "youtube", nativeId: "RgKAFK5djSk", title: "See You Again", artist: "Wiz Khalifa" },
  { rank: 4, source: "youtube", nativeId: "OPf0YbXqDm0", title: "Uptown Funk", artist: "Mark Ronson" },
  { rank: 5, source: "youtube", nativeId: "JGwWNGJdvx8", title: "Shape of You", artist: "Ed Sheeran" },
] as const;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("[seed] DATABASE_URL is not set — cannot seed. Set it in .env.local first.");
  }
  for (const track of STARTER_PICKS) {
    const row = { ...track, artUrl: ytArt(track.nativeId) };
    // Idempotent: re-running refreshes the row at each rank rather than duplicating.
    await prisma.trendingSeed.upsert({
      where: { rank: row.rank },
      create: row,
      update: {
        source: row.source,
        nativeId: row.nativeId,
        title: row.title,
        artist: row.artist,
        artUrl: row.artUrl,
      },
    });
  }
  console.log(`[seed] starter picks written: ${STARTER_PICKS.length} rows (shown as "Starter picks", not "Trending").`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
