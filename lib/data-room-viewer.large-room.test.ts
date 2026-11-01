jest.mock("server-only", () => ({}), { virtual: true });

import { buildViewerPayload } from "./data-room-viewer.server";
import { fakeDb, type Row } from "../test-utils/fake-supabase";

const MAX_IN_IDS = 150;

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
    const { client } = fakeDb(room(2500), { maxInIds: MAX_IN_IDS });
    const payload = await buildViewerPayload(client, "org", "room", null);
    expect(payload).not.toBeNull();
    const shown = payload!.docSections.flatMap((s) => s.docs);
    expect(shown).toHaveLength(2500);
    expect(new Set(shown.map((d) => d.id)).size).toBe(2500);
  });

  it("never sends an .in() with more ids than the gateway allows", async () => {
    const { client, requests } = fakeDb(room(2500), { maxInIds: MAX_IN_IDS });
    await buildViewerPayload(client, "org", "room", null);
    const sizes = requests.filter((r) => r.inSize !== undefined).map((r) => r.inSize as number);
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_IN_IDS);
  });

  it("still serves an ordinary small room in one pass", async () => {
    const { client } = fakeDb(room(3), { maxInIds: MAX_IN_IDS });
    const payload = await buildViewerPayload(client, "org", "room", null);
    expect(payload!.docSections.flatMap((s) => s.docs).map((d) => d.name)).toEqual(["File 0", "File 1", "File 2"]);
  });
});
