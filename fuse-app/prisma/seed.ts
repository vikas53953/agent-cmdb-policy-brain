// Curated trending seed (KTD-4). Home shows this ordered list until enough anonymous
// play data accumulates for real aggregate trending to graduate in (U12). Run with
// `npm run db:seed` against a database that has the schema applied.
//
// KEYLESS-SAFE: this script only runs when explicitly invoked (never during build or
// typecheck), so it may assume DATABASE_URL is set. It fails loudly with an honest
// message if it isn't, rather than silently writing nowhere.
//
// The tracks below are placeholder YouTube video ids standing in for a real curated
// list — the owner replaces them with hand-picked trending songs at deploy time. They
// are NOT secrets (public video ids); no real key or credential appears here.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CURATED_TRENDING = [
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
  for (const track of CURATED_TRENDING) {
    // Idempotent: re-running refreshes the row at each rank rather than duplicating.
    await prisma.trendingSeed.upsert({
      where: { rank: track.rank },
      create: { ...track },
      update: { source: track.source, nativeId: track.nativeId, title: track.title, artist: track.artist },
    });
  }
  console.log(`[seed] curated trending seed written: ${CURATED_TRENDING.length} rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
