import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import { normalizeQuery, readSearchCache, writeSearchCache } from "./search-cache";

describe("search cache normalization", () => {
  it("collapses whitespace, trims, and lowercases so variants share a key", () => {
    expect(normalizeQuery("  Paper   Cities ")).toBe("paper cities");
    expect(normalizeQuery("PAPER CITIES")).toBe("paper cities");
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
