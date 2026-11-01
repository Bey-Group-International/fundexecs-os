jest.mock("server-only", () => ({}), { virtual: true });

import { buildViewerPayload } from "./data-room-viewer.server";

// A fake database that enforces the two limits that cut a big room short in
// production: PostgREST's max_rows (1000) on any read that is not ranged, and a
// ceiling on how many ids a single `.in()` may carry (the request URL overflows).
const MAX_ROWS = 1000;
const MAX_IN_IDS = 150;

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const requests: { table: string; inSize?: number }[] = [];
  function from(table: string) {
    let rows = [...(tables[table] ?? [])];
    let range: [number, number] | null = null;
    let single = false;
    let inSize: number | undefined;
    let error: { message: string } | null = null;
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b),
      in: (c: string, vals: unknown[]) => {
        inSize = vals.length;
        if (vals.length > MAX_IN_IDS) error = { message: "URI too long" };
        else rows = rows.filter((r) => vals.includes(r[c]));
        return b;
      },
      order: (c: string, o?: { ascending?: boolean }) => (
        rows.sort((x, y) => ((x[c] as number) > (y[c] as number) ? 1 : -1) * (o?.ascending === false ? -1 : 1)), b
      ),
      limit: (n: number) => ((rows = rows.slice(0, n)), b),
      range: (f: number, t: number) => ((range = [f, t]), b),
      maybeSingle: () => ((single = true), b),
      then: (resolve: (v: unknown) => unknown) => {
        requests.push({ table, inSize });
        if (error) return resolve({ data: null, error });
        const out = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, MAX_ROWS);
        return resolve({ data: single ? (out[0] ?? null) : out, error: null });
      },
    };
    return b;
  }
  return { client: { from } as never, requests };
}

function room(fileCount: number) {
  const manifest: Row[] = [];
  const documents: Row[] = [];
  for (let i = 0; i < fileCount; i++) {
    const id = `doc-${String(i).padStart(5, "0")}`;
    manifest.push({ organization_id: "org", room_id: "room", document_id: id, sort_order: i, require_signature: false });
    documents.push({ id, organization_id: "org", name: `File ${i}`, doc_type: "marketing", content: "x", storage_key: null });
  }
  return {
    data_rooms: [{ id: "room", organization_id: "org", archived_at: null }],
    organizations: [{ id: "org", name: "Alpha Capital" }],
    investment_theses: [],
    track_records: [],
    entities: [],
    organization_members: [],
    principals: [],
    data_room_documents: manifest,
    documents,
  };
}

describe("a room with more files than one request can carry", () => {
  it("shows all 2,500 files, not the first 1,000 and not an empty room", async () => {
    const { client } = fakeDb(room(2500));
    const payload = await buildViewerPayload(client, "org", "room", null);
    expect(payload).not.toBeNull();
    const shown = payload!.docSections.flatMap((s) => s.docs);
    expect(shown).toHaveLength(2500);
    expect(new Set(shown.map((d) => d.id)).size).toBe(2500);
  });

  it("never sends an .in() with more ids than the gateway allows", async () => {
    const { client, requests } = fakeDb(room(2500));
    await buildViewerPayload(client, "org", "room", null);
    const sizes = requests.filter((r) => r.inSize !== undefined).map((r) => r.inSize as number);
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_IN_IDS);
  });

  it("still serves an ordinary small room in one pass", async () => {
    const { client } = fakeDb(room(3));
    const payload = await buildViewerPayload(client, "org", "room", null);
    expect(payload!.docSections.flatMap((s) => s.docs).map((d) => d.name)).toEqual(["File 0", "File 1", "File 2"]);
  });
});
