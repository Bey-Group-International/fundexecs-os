/**
 * What a reader is allowed to receive from a data room, pinned against a fake
 * database. These are the guarantees a refactor must not quietly undo:
 *
 *  - a file that needs a signature leaves the server with nothing of itself in
 *    it until this reader has signed;
 *  - a read that fails never turns into a room that looks empty or a file that
 *    looks unlocked: it throws, so nothing is served and nobody is told the
 *    firm simply has no documents;
 *  - an archived room serves nothing;
 *  - a link's section allowlist is a boundary, and `[]` allows nothing.
 */
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/email", () => ({ escapeHtml: (s: string) => s, sendEmail: jest.fn() }));

import { buildViewerPayload, isRoomOpen } from "./data-room-viewer.server";
import { DataRoomReadError } from "./data-room-errors";
import { fakeDb, type Row } from "../test-utils/fake-supabase";

const ORG = "org-1";
const ROOM = "room-1";
const SHARE = "share-1";
const SECRET_TEXT = "CONFIDENTIAL TERMS: carry 20%, hurdle 8%";
const SECRET_PATH = "org-1/doc-a/terms.pdf";

interface FileSpec {
  id: string;
  name?: string;
  doc_type?: string | null;
  content?: string | null;
  storage_key?: string | null;
  require_signature?: boolean;
}

function tables(files: FileSpec[], extra: Partial<Record<string, Row[]>> = {}, roomArchived = false) {
  return {
    data_rooms: [{ id: ROOM, organization_id: ORG, archived_at: roomArchived ? "2026-01-01T00:00:00Z" : null }],
    organizations: [{ id: ORG, name: "Alpha Capital" }],
    investment_theses: [],
    track_records: [],
    entities: [],
    organization_members: [],
    principals: [],
    data_room_document_signatures: [],
    data_room_documents: files.map((f, i) => ({
      organization_id: ORG,
      room_id: ROOM,
      document_id: f.id,
      sort_order: i,
      require_signature: f.require_signature ?? false,
    })),
    documents: files.map((f) => ({
      id: f.id,
      organization_id: ORG,
      name: f.name ?? f.id,
      doc_type: f.doc_type === undefined ? "fund_terms" : f.doc_type,
      content: f.content ?? null,
      storage_key: f.storage_key ?? null,
    })),
    ...extra,
  } as Record<string, Row[]>;
}

const LOCKED: FileSpec = {
  id: "doc-a",
  name: "Side letter",
  content: SECRET_TEXT,
  storage_key: SECRET_PATH,
  require_signature: true,
};
const OPEN: FileSpec = { id: "doc-b", name: "Deck", content: "public deck", storage_key: null };

const allDocs = (p: Awaited<ReturnType<typeof buildViewerPayload>>) => p!.docSections.flatMap((s) => s.docs);

describe("a file that requires a signature", () => {
  it("leaves the server with none of itself in it until this reader has signed", async () => {
    const { client } = fakeDb(tables([LOCKED, OPEN]));
    const payload = await buildViewerPayload(client, ORG, ROOM, null, null, { shareId: SHARE, email: "lp@example.com" });
    const locked = allDocs(payload).find((d) => d.id === "doc-a")!;
    expect(locked).toMatchObject({ content: null, storage_key: null, requiresSignature: true, signed: false, preview_kind: "none" });
    // Not just the fields above: no trace of it anywhere in what is sent.
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain(SECRET_TEXT);
    expect(wire).not.toContain(SECRET_PATH);
    // The rest of the room is unaffected.
    expect(allDocs(payload).find((d) => d.id === "doc-b")!.content).toBe("public deck");
  });

  it("is locked for the GP preview, which has no reader", async () => {
    const { client } = fakeDb(tables([LOCKED]));
    const payload = await buildViewerPayload(client, ORG, ROOM, null);
    expect(allDocs(payload)[0]).toMatchObject({ content: null, storage_key: null, signed: false });
  });

  it("opens for the reader who signed it, matching their email regardless of case", async () => {
    const { client } = fakeDb(
      tables([LOCKED], { data_room_document_signatures: [{ share_id: SHARE, document_id: "doc-a", signer_email: "lp@example.com" }] }),
    );
    const payload = await buildViewerPayload(client, ORG, ROOM, null, null, { shareId: SHARE, email: "LP@Example.com" });
    expect(allDocs(payload)[0]).toMatchObject({ content: SECRET_TEXT, storage_key: SECRET_PATH, requiresSignature: true, signed: true });
  });

  it("stays locked for a different reader, and for the same email on a different link", async () => {
    const sig = { share_id: SHARE, document_id: "doc-a", signer_email: "lp@example.com" };
    const other = fakeDb(tables([LOCKED], { data_room_document_signatures: [sig] }));
    expect(allDocs(await buildViewerPayload(other.client, ORG, ROOM, null, null, { shareId: SHARE, email: "someone@else.com" }))[0].content).toBeNull();
    const otherLink = fakeDb(tables([LOCKED], { data_room_document_signatures: [sig] }));
    expect(allDocs(await buildViewerPayload(otherLink.client, ORG, ROOM, null, null, { shareId: "share-2", email: "lp@example.com" }))[0].content).toBeNull();
  });

  it("takes the requirement from the same read as membership, so an unpublish between two reads can't unlock it", async () => {
    const db = fakeDb(tables([LOCKED, OPEN]));
    await buildViewerPayload(db.client, ORG, ROOM, null);
    // One read of the manifest for a room link. A second, separate read is the
    // window in which a file could be returned without its requirement.
    expect(db.readsOf("data_room_documents")).toBe(1);
  });
});

describe("a read that fails", () => {
  // Each of these reads feeds what the reader sees. None may come back as an
  // empty answer: an empty manifest is an empty room, an empty requirement list
  // is every file unlocked.
  it.each([
    ["the room's state", "data_rooms", "room"],
    ["the manifest", "data_room_documents", "manifest"],
    ["the documents", "documents", "documents"],
    ["the organisation", "organizations", "organization"],
    ["the track record", "track_records", "track-records"],
    ["the team", "organization_members", "members"],
  ])("throws instead of serving a partial room when %s can't be read", async (_label, table, where) => {
    const db = fakeDb(tables([LOCKED, OPEN]));
    db.fail[table] = "08006";
    const err = await buildViewerPayload(db.client, ORG, ROOM, null).catch((e) => e);
    expect(err).toBeInstanceOf(DataRoomReadError);
    expect((err as DataRoomReadError).where).toBe(where);
    expect((err as DataRoomReadError).code).toBe("08006");
  });

  it("throws when a single-document link can't read whether its file needs a signature", async () => {
    // The single-document path reads the requirement on its own. Treating an
    // error there as "none required" would open a locked file.
    const db = fakeDb(tables([LOCKED]));
    db.fail["data_room_documents"] = "08006";
    await expect(buildViewerPayload(db.client, ORG, ROOM, null, "doc-a")).rejects.toBeInstanceOf(DataRoomReadError);
  });

  it("throws when who has signed can't be read, instead of re-showing the form for a file already signed", async () => {
    const db = fakeDb(tables([LOCKED]));
    db.fail["data_room_document_signatures"] = "08006";
    await expect(
      buildViewerPayload(db.client, ORG, ROOM, null, null, { shareId: SHARE, email: "lp@example.com" }),
    ).rejects.toBeInstanceOf(DataRoomReadError);
  });

  it("puts nothing it was asked about in the error", async () => {
    const db = fakeDb(tables([LOCKED]));
    db.fail["documents"] = "08006";
    const err = (await buildViewerPayload(db.client, ORG, ROOM, null).catch((e) => e)) as Error;
    expect(err.message).not.toContain(SECRET_TEXT);
    expect(err.message).not.toContain(ROOM);
  });
});

describe("a room that is archived", () => {
  it("serves nothing, even to a link that is otherwise live", async () => {
    const { client } = fakeDb(tables([OPEN], {}, true));
    expect(await buildViewerPayload(client, ORG, ROOM, null)).toBeNull();
    expect(await isRoomOpen(client, ORG, ROOM)).toBe(false);
  });

  it("is told apart from a room whose state could not be read", async () => {
    const db = fakeDb(tables([OPEN]));
    db.fail["data_rooms"] = "08006";
    await expect(isRoomOpen(db.client, ORG, ROOM)).rejects.toBeInstanceOf(DataRoomReadError);
  });
});

describe("a link's section allowlist", () => {
  const files: FileSpec[] = [
    { id: "t", name: "Terms", doc_type: "fund_terms", content: "a" },
    { id: "m", name: "Deck", doc_type: "marketing", content: "b" },
  ];

  it("shows every published section when unrestricted", async () => {
    const { client } = fakeDb(tables(files));
    expect(allDocs(await buildViewerPayload(client, ORG, ROOM, null)).map((d) => d.id).sort()).toEqual(["m", "t"]);
  });

  it("narrows to the sections it names", async () => {
    const { client } = fakeDb(tables(files));
    expect(allDocs(await buildViewerPayload(client, ORG, ROOM, ["marketing"])).map((d) => d.id)).toEqual(["m"]);
  });

  it("allows nothing when the allowlist is empty, not everything", async () => {
    const { client } = fakeDb(tables(files));
    expect(allDocs(await buildViewerPayload(client, ORG, ROOM, []))).toEqual([]);
  });

  it("files a document with an unrecognised or missing section under Other, rather than dropping it", async () => {
    const { client } = fakeDb(tables([{ id: "x", doc_type: "wiki", content: "a" }, { id: "y", doc_type: null, content: "b" }]));
    const payload = await buildViewerPayload(client, ORG, ROOM, null);
    expect(payload!.docSections.map((s) => s.key)).toEqual(["other"]);
    expect(allDocs(payload).map((d) => d.id).sort()).toEqual(["x", "y"]);
  });
});

describe("a single-document link", () => {
  it("shows its one document, published or not, and ignores the section allowlist", async () => {
    const t = tables([{ id: "pub", content: "p" }, { id: "draft", content: "d" }]);
    // "draft" is in the library but not in this room's manifest.
    t.data_room_documents = t.data_room_documents.filter((m) => m.document_id === "pub");
    const { client } = fakeDb(t);
    const payload = await buildViewerPayload(client, ORG, ROOM, ["marketing"], "draft");
    expect(allDocs(payload).map((d) => d.id)).toEqual(["draft"]);
  });
});
