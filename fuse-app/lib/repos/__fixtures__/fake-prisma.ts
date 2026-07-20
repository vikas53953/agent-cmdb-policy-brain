// A minimal in-memory fake of the Prisma client for repo unit tests. It HONORS the
// `where` clause (including Prisma composite-key objects like
// `{ ownerId_source_nativeId: {...} }`), so the tests prove the repos' tenancy
// scoping — a row owned by another user is filtered out by the QUERY the repo builds,
// not by the test. Mirrors the fake-store discipline from SubTrackr's repo tests.
//
// This lives under __fixtures__ (not matched by the `*.test.ts` vitest glob) so it is
// shared by several repo tests without itself being collected as a test file.

type Row = Record<string, unknown> & { id?: string };

// Flatten a Prisma composite-unique where value into scalar field matches. A composite
// unique arrives nested, e.g. { ownerId_source_nativeId: { ownerId, source, nativeId } }
// or { ownerId_key: { ownerId, key } }; we treat any plain-object (non-Date) value as a
// group of nested field constraints.
// A filter operator object like `{ not: "local" }` — Prisma's way of expressing a
// scalar constraint. Distinguished from a composite-key group by its operator keys.
const FILTER_OPS = new Set(["not", "in", "notIn"]);

function isFilterOp(v: Record<string, unknown>): boolean {
  return Object.keys(v).some((k) => FILTER_OPS.has(k));
}

function matchesOp(op: Record<string, unknown>, value: unknown): boolean {
  if ("not" in op && value === op.not) return false;
  if ("in" in op && !(op.in as unknown[]).includes(value)) return false;
  if ("notIn" in op && (op.notIn as unknown[]).includes(value)) return false;
  return true;
}

function flatten(where: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR" || k === "AND" || k === "NOT") {
      out[k] = v;
    } else if (
      v !== null &&
      typeof v === "object" &&
      !(v instanceof Date) &&
      !isFilterOp(v as Record<string, unknown>)
    ) {
      for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) out[nk] = nv;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function matches(where: Record<string, unknown> | undefined, row: Row): boolean {
  if (!where) return true;
  const flat = flatten(where);
  for (const [k, v] of Object.entries(flat)) {
    if (v === undefined) continue;
    // `OR` is satisfied when ANY branch matches — the batched-enrichment query shape.
    if (k === "OR") {
      const branches = v as Record<string, unknown>[];
      if (!branches.some((b) => matches(b, row))) return false;
      continue;
    }
    if (k === "AND") {
      const branches = v as Record<string, unknown>[];
      if (!branches.every((b) => matches(b, row))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && isFilterOp(v as Record<string, unknown>)) {
      if (!matchesOp(v as Record<string, unknown>, row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

type OrderBy = Record<string, "asc" | "desc"> | undefined;

function applyOrder(rows: Row[], orderBy: OrderBy): Row[] {
  if (!orderBy) return rows;
  const [field, dir] = Object.entries(orderBy)[0];
  const sorted = [...rows].sort((a, b) => {
    const av = a[field] as number | string | Date;
    const bv = b[field] as number | string | Date;
    if (av === bv) return 0;
    return av < bv ? -1 : 1;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

// A fake delegate for one Prisma model, backed by a shared array. Records call args on
// `calls` so tests can assert the exact where/data shapes the repo built.
export function makeModel(seed: Row[] = []) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  const calls: Record<string, unknown[]> = {
    findMany: [],
    findFirst: [],
    findUnique: [],
    create: [],
    upsert: [],
    update: [],
    updateMany: [],
    deleteMany: [],
    count: [],
    groupBy: [],
  };
  const model = {
    findMany: async (a: { where?: Record<string, unknown>; orderBy?: OrderBy; take?: number } = {}) => {
      calls.findMany.push(a);
      let out = rows.filter((r) => matches(a.where, r));
      out = applyOrder(out, a.orderBy);
      if (typeof a.take === "number") out = out.slice(0, a.take);
      return out.map((r) => ({ ...r }));
    },
    findFirst: async (a: { where?: Record<string, unknown>; orderBy?: OrderBy } = {}) => {
      calls.findFirst.push(a);
      const out = applyOrder(rows.filter((r) => matches(a.where, r)), a.orderBy);
      return out[0] ? { ...out[0] } : null;
    },
    findUnique: async (a: { where: Record<string, unknown> }) => {
      calls.findUnique.push(a);
      const found = rows.find((r) => matches(a.where, r));
      return found ? { ...found } : null;
    },
    create: async (a: { data: Row }) => {
      calls.create.push(a);
      const row = { id: a.data.id ?? nextId(), ...a.data } as Row;
      rows.push(row);
      return { ...row };
    },
    upsert: async (a: { where: Record<string, unknown>; create: Row; update: Row }) => {
      calls.upsert.push(a);
      const existing = rows.find((r) => matches(a.where, r));
      if (existing) {
        Object.assign(existing, a.update);
        return { ...existing };
      }
      const row = { id: a.create.id ?? nextId(), ...a.create } as Row;
      rows.push(row);
      return { ...row };
    },
    update: async (a: { where: Record<string, unknown>; data: Row }) => {
      calls.update.push(a);
      const existing = rows.find((r) => matches(a.where, r));
      if (!existing) throw new Error("fake update: row not found");
      Object.assign(existing, a.data);
      return { ...existing };
    },
    updateMany: async (a: { where?: Record<string, unknown>; data: Row }) => {
      calls.updateMany.push(a);
      const m = rows.filter((r) => matches(a.where, r));
      m.forEach((r) => Object.assign(r, a.data));
      return { count: m.length };
    },
    deleteMany: async (a: { where?: Record<string, unknown> }) => {
      calls.deleteMany.push(a);
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(a.where, rows[i])) {
          rows.splice(i, 1);
          removed++;
        }
      }
      return { count: removed };
    },
    count: async (a: { where?: Record<string, unknown> } = {}) => {
      calls.count.push(a);
      return rows.filter((r) => matches(a.where, r)).length;
    },
    // Minimal groupBy for the trending aggregate: group by the given scalar fields and
    // return a _count._all per group, ordered/taken as requested.
    // `where` is honored here too, so a repo that scopes its aggregate (e.g. trending
    // excluding local-file plays) is proven by the QUERY it builds, not by the test.
    groupBy: async (a: {
      by: string[];
      where?: Record<string, unknown>;
      orderBy?: { _count?: Record<string, "asc" | "desc"> };
      take?: number;
    }) => {
      calls.groupBy.push(a);
      const buckets = new Map<string, { key: Record<string, unknown>; count: number }>();
      for (const r of rows.filter((r) => matches(a.where, r))) {
        const keyObj: Record<string, unknown> = {};
        for (const f of a.by) keyObj[f] = r[f];
        const k = JSON.stringify(keyObj);
        const b = buckets.get(k) ?? { key: keyObj, count: 0 };
        b.count += 1;
        buckets.set(k, b);
      }
      let groups = [...buckets.values()].map((b) => ({ ...b.key, _count: { _all: b.count } }));
      const dir = a.orderBy?._count ? Object.values(a.orderBy._count)[0] : undefined;
      if (dir) {
        groups = groups.sort((x, y) => x._count._all - y._count._all);
        if (dir === "desc") groups.reverse();
      }
      if (typeof a.take === "number") groups = groups.slice(0, a.take);
      return groups;
    },
  };
  return { model, rows, calls };
}

// Build a fake PrismaClient exposing the given model delegates plus a $transaction
// that runs its callback with the same fake client (so in-transaction writes hit the
// same in-memory rows).
export function makePrisma(models: Record<string, ReturnType<typeof makeModel>["model"]>) {
  const client: Record<string, unknown> = { ...models };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return client as unknown as import("@prisma/client").PrismaClient;
}
