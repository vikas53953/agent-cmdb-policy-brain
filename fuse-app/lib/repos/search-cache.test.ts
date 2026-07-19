import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import {
  normalizeQuery,
  cacheKey,
  readSearchCache,
  writeSearchCache,
  SEARCH_CACHE_VERSION,
} from "./search-cache";

describe("search cache normalization", () => {
  it("collapses whitespace, trims, and lowercases so variants share a key", () => {
    expect(normalizeQuery("  Paper   Cities ")).toBe("paper cities");
    expect(normalizeQuery("PAPER CITIES")).toBe("paper cities");
  });

  it("the stored key is the schema version prefixed onto the normalized query", () => {
    // The version prefix is what invalidates every pre-fix entry on deploy (P1): bump the
    // version and old-shape rows can never be read again (their key no longer collides).
    expect(cacheKey("  Paper   Cities ")).toBe(`${SEARCH_CACHE_VERSION}:paper cities`);
    expect(cacheKey("paper cities")).toContain(":");
  });
});

describe("search cache versioning (P1: stale entries miss on deploy)", () => {
  it("writes under the versioned key, so a pre-fix (unversioned) row is a miss", async () => {
    const model = makeModel();
    const prisma = makePrisma({ searchCache: model.model });
    const now = new Date("2026-07-17T00:00:00Z");

    // A pre-fix entry sat under the BARE normalized key with a stale reason string baked in.
    model.rows.push({
      queryKey: normalizeQuery("paper cities"), // unversioned — the old scheme
      results: { results: [], sources: { spotify: { reason: "…try again" } } },
      expiresAt: new Date(now.getTime() + 60_000),
    });

    // The read now looks up the VERSIONED key, so that stale row is invisible — a miss.
    expect(await readSearchCache("paper cities", prisma, now)).toBeNull();

    // A fresh write lands under the versioned key, alongside (not overwriting) the old row.
    await writeSearchCache("paper cities", { results: [{ id: "fresh" }] }, prisma, 60_000, now);
    const stored = model.rows.find((r) => r.queryKey === `${SEARCH_CACHE_VERSION}:paper cities`);
    expect(stored).toBeDefined();
    expect(await readSearchCache("paper cities", prisma, now)).toEqual({ results: [{ id: "fresh" }] });
  });
});

describe("search cache read/write (KTD-8 quota defence)", () => {
  it("a cached, unexpired query is a hit — no external call path", async () => {
    const model = makeModel();
    const prisma = makePrisma({ searchCache: model.model });
    const now = new Date("2026-07-17T00:00:00Z");

    // Cold: no entry → null (route would call the external APIs).
    expect(await readSearchCache("paper cities", prisma, now)).toBeNull();

    // Warm the cache.
    await writeSearchCache("Paper  Cities", [{ id: "v1" }], prisma, 60_000, now);

    // Same query (differently spaced/cased) within TTL → served from cache.
    const hit = await readSearchCache("paper cities", prisma, new Date(now.getTime() + 30_000));
    expect(hit).toEqual([{ id: "v1" }]);
    // Only one row ever exists (upsert on the normalized key).
    expect(model.rows).toHaveLength(1);
  });

  it("an expired entry reads as a miss (null), forcing a refresh", async () => {
    const model = makeModel();
    const prisma = makePrisma({ searchCache: model.model });
    const now = new Date("2026-07-17T00:00:00Z");
    await writeSearchCache("paper cities", [{ id: "v1" }], prisma, 60_000, now);

    const afterTtl = new Date(now.getTime() + 60_001);
    expect(await readSearchCache("paper cities", prisma, afterTtl)).toBeNull();
  });
});
