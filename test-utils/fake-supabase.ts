// test-utils/fake-supabase.ts
//
// An in-memory stand-in for the slice of the Supabase query builder the data
// room reads use. It exists so the guarantees on that path can be pinned
// against a database that behaves like production where it matters:
//
//  - max_rows: a read that is not ranged returns at most `maxRows` rows and
//    says nothing when it truncates (PostgREST's behaviour).
//  - URL length: an `.in()` carrying more than `maxInIds` ids fails.
//  - failure injection: name a table in `fail` and every read of it errors.
//  - writes: `.insert()` is recorded in `inserts` and answers success.
//
// It is deliberately small. It models filters by equality, `.in`, `.is` and
// `.ilike` (equality, case-insensitively), ordering, ranges and
// maybeSingle, and nothing else, so a query that needs more fails loudly here
// rather than passing against a fake that quietly answers it.

export type Row = Record<string, unknown>;

export interface FakeDbOptions {
  maxRows?: number;
  maxInIds?: number;
}

export interface FakeRequest {
  table: string;
  /** Ids carried by an `.in()`, when there was one. */
  inSize?: number;
}

export function fakeDb(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const maxRows = options.maxRows ?? 1000;
  const maxInIds = options.maxInIds ?? 150;
  const requests: FakeRequest[] = [];
  /** Rows written with `.insert()`, in order. Writes are recorded, not stored. */
  const inserts: { table: string; row: unknown }[] = [];
  /** table -> database error code. A table named here fails every read. */
  const fail: Record<string, string> = {};

  function from(table: string) {
    let rows = [...(tables[table] ?? [])];
    let range: [number, number] | null = null;
    let single = false;
    let inSize: number | undefined;
    let tooLong = false;

    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
      in: (c: string, vals: unknown[]) => {
        inSize = vals.length;
        if (vals.length > maxInIds) tooLong = true;
        else rows = rows.filter((r) => vals.includes(r[c]));
        return q;
      },
      // The callers escape `\`, `%` and `_`, so the pattern is a literal here.
      ilike: (c: string, pattern: string) => {
        const literal = pattern.replace(/\\([\\%_])/g, "$1").toLowerCase();
        rows = rows.filter((r) => String(r[c] ?? "").toLowerCase() === literal);
        return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        const dir = o?.ascending === false ? -1 : 1;
        rows.sort((x, y) => ((x[c] as number) > (y[c] as number) ? 1 : (x[c] as number) < (y[c] as number) ? -1 : 0) * dir);
        return q;
      },
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      range: (f: number, t: number) => ((range = [f, t]), q),
      maybeSingle: () => ((single = true), q),
      insert: (row: unknown) => {
        inserts.push({ table, row });
        return { then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }) };
      },
      then: (resolve: (v: unknown) => unknown) => {
        requests.push({ table, inSize });
        if (fail[table]) return resolve({ data: null, error: { message: "injected failure", code: fail[table] } });
        if (tooLong) return resolve({ data: null, error: { message: "URI too long", code: "PGRST000" } });
        const out = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, maxRows);
        return resolve({ data: single ? (out[0] ?? null) : out, error: null });
      },
    };
    return q;
  }

  return {
    // Cast: the data room code takes a SupabaseClient, and this is the subset it uses.
    client: { from } as never,
    requests,
    inserts,
    fail,
    /** How many reads hit `table`. */
    readsOf: (table: string) => requests.filter((r) => r.table === table).length,
  };
}
