/**
 * Minting the link, and the three ways that can go sideways.
 *
 * The pure rules are tested in doc-share.test.ts. What is left here is the part
 * that writes, and the cases worth pinning are the ones that leave something
 * behind if they are wrong:
 *
 *   a second tap must hand back the FIRST link, not mint a rival one with its
 *   own expiry and its own line in the audit export;
 *
 *   losing the race on the unique index must return the winner's link AND
 *   revoke the loser's, because an unreferenced live link to the firm's
 *   materials is exactly what nobody ever goes back and cleans up;
 *
 *   the gates are a policy decision, so they are asserted rather than left to
 *   whatever the Share panel's defaults happen to be this month.
 */
jest.mock("server-only", () => ({}), { virtual: true });

const insertShare = jest.fn();
/** Reads and the share mint: the RLS-bound client the caller's session owns. */
const from = jest.fn();
/**
 * Writes to the join table: the service role.
 *
 * Kept as a SEPARATE mock on purpose. The first version of this file pointed
 * both clients at one `from`, which made the distinction invisible — and the
 * code was in fact writing the join row through the RLS client, against a table
 * whose only policy is FOR SELECT, so every insert was refused and the feature
 * did not work at all. A test cannot catch that while both clients are the same
 * object.
 */
const serviceFrom = jest.fn();

jest.mock("@/lib/data-room-shares.server", () => ({
  insertShare: (...a: unknown[]) => insertShare(...a),
  shareUrl: (token: string) => `https://app.test/dataroom/${token}`,
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
  createServiceClient: () => ({ from: (t: string) => serviceFrom(t) }),
  hasSupabaseServiceEnv: () => true,
}));

import { DOC_SHARE_EXPIRY_DAYS } from "@/lib/meetings/doc-share";
import { loadSharedInMeeting, shareDocumentInMeeting } from "@/lib/meetings/doc-share.server";

/** Rows the fake database hands back, per table. */
interface Tables {
  rooms: { id: string; name: string; is_default: boolean }[];
  entries: { room_id: string; document_id: string; sort_order: number }[];
  documents: {
    id: string; name: string; doc_type: string | null; status: string | null;
    storage_key: string | null; content: string | null;
  }[];
  /** Join rows, in the order a read returns them. */
  shared: {
    id: string;
    document_id: string;
    created_at: string;
    data_room_shares: { token: string; expires_at: string | null; revoked_at: string | null };
  }[];
}

const inserts: { table: string; row: Record<string, unknown>; via: string }[] = [];
const updates: { table: string; row: Record<string, unknown>; id: string; via: string }[] = [];

/**
 * A fake just deep enough to exercise the real query shapes.
 *
 * Every builder method returns the builder, and the builder is itself a
 * thenable — which is what the real client is. Terminating the chain on a
 * specific method instead would have encoded WHERE each query happens to end
 * today (`in` for documents, the second `order` for rooms, `limit` for the
 * manifest), and a query gaining one more clause would then resolve to
 * undefined rather than fail.
 *
 * `sharedReads` lets the SECOND read of the join table return what the first
 * did not, which is the only way to reproduce the unique-index race without
 * two processes.
 */
function wire(opts: {
  tables: Partial<Tables>;
  sharedReads?: Tables["shared"][];
  insertError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const tables: Tables = { rooms: [], entries: [], documents: [], shared: [], ...opts.tables };
  let sharedCall = 0;

  function rowsFor(table: string): unknown[] {
    if (table === "data_rooms") return tables.rooms;
    if (table === "data_room_documents") return tables.entries;
    if (table === "documents") return tables.documents;
    if (table === "live_meeting_shared_documents") {
      const reads = opts.sharedReads;
      if (!reads) return tables.shared;
      return reads[Math.min(sharedCall++, reads.length - 1)] ?? [];
    }
    return [];
  }

  /**
   * `via` names which client this builder belongs to, so a test can assert that
   * the join row was written as the service role rather than merely that it was
   * written.
   */
  const build = (via: "authed" | "service") => (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of ["select", "eq", "is", "in", "order", "limit", "not", "neq"]) {
      builder[method] = chain;
    }
    builder.maybeSingle = async () => ({ data: null, error: null });
    builder.insert = async (row: Record<string, unknown>) => {
      inserts.push({ table, row, via });
      return { error: opts.insertError ?? null };
    };
    builder.update = (row: Record<string, unknown>) => ({
      eq: async (_col: string, id: string) => {
        updates.push({ table, row, id, via });
        return { error: opts.updateError ?? null };
      },
    });
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rowsFor(table), error: null }).then(resolve, reject);
    return builder;
  };

  from.mockImplementation(build("authed"));
  serviceFrom.mockImplementation(build("service"));
}

/** A join row whose link still opens. */
function live(documentId: string, token: string) {
  return {
    id: `row-${documentId}`,
    document_id: documentId,
    created_at: "2026-09-01T00:00:00.000Z",
    data_room_shares: { token, expires_at: null, revoked_at: null },
  };
}
/** A join row whose link has been revoked from the Shares panel. */
function revoked(documentId: string, token: string) {
  return {
    ...live(documentId, token),
    data_room_shares: { token, expires_at: null, revoked_at: "2026-09-02T00:00:00.000Z" },
  };
}
/** A join row whose link has run past its expiry. */
function expired(documentId: string, token: string) {
  return {
    ...live(documentId, token),
    data_room_shares: { token, expires_at: "2026-09-10T00:00:00.000Z", revoked_at: null },
  };
}

const ROOMS = [{ id: "room-1", name: "Primary Data Room", is_default: true }];
const ENTRIES = [{ room_id: "room-1", document_id: "d1", sort_order: 0 }];
const DOCS = [
  {
    id: "d1", name: "Investor Deck", doc_type: "marketing", status: "ready",
    storage_key: "org/doc.pdf", content: null,
  },
];

const INPUT = {
  meetingId: "m1",
  meetingTitle: "Fund IV sync",
  orgId: "org-1",
  userId: "user-1",
  documentId: "d1",
  now: Date.UTC(2026, 9, 1, 12, 0, 0),
};

beforeEach(() => {
  jest.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
  insertShare.mockResolvedValue({ id: "share-1", token: "tok1" });
});

describe("the happy path", () => {
  it("mints a link, records it against the meeting, and returns it", async () => {
    wire({ tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS } });

    const out = await shareDocumentInMeeting(INPUT);

    expect(out).toEqual({
      ok: true,
      url: "https://app.test/dataroom/tok1",
      documentName: "Investor Deck",
      alreadyShared: false,
    });
    expect(inserts).toEqual([
      {
        table: "live_meeting_shared_documents",
        via: "service",
        row: {
          meeting_id: "m1",
          organization_id: "org-1",
          document_id: "d1",
          room_id: "room-1",
          share_id: "share-1",
          shared_by: "user-1",
        },
      },
    ]);
  });

  it("mints it with the gates a call-time link is supposed to have", async () => {
    wire({ tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS } });

    await shareDocumentInMeeting(INPUT);

    expect(insertShare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        documentId: "d1",
        roomId: "room-1",
        label: "Shared in: Fund IV sync",
        expiresInDays: DOC_SHARE_EXPIRY_DAYS,
        // ON: it is what makes the audit log name a reader rather than a token,
        // and what makes the watermark worth having.
        requireEmail: true,
        watermark: true,
        // OFF: an NDA gate would stop the person you are talking to from
        // opening the document while you are talking about it.
        requireNda: false,
        // OFF: there is nobody to tell a password to without saying it out loud
        // on a call that may be recorded.
        password: null,
        // ON: you are on a call with this person and they asked for it.
        allowDownload: true,
        // Null: the link is about to be said in the room, and an email as well
        // would be a second copy to an address nobody supplied.
        recipientEmail: null,
      }),
    );
  });
});

describe("the second tap", () => {
  it("hands back the first link without minting another", async () => {
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      sharedReads: [[live("d1", "already")]],
    });

    const out = await shareDocumentInMeeting(INPUT);

    expect(out).toEqual({
      ok: true,
      url: "https://app.test/dataroom/already",
      documentName: "Investor Deck",
      alreadyShared: true,
    });
    expect(insertShare).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("still refuses a document that has since been reverted to draft", async () => {
    // A link exists, but re-announcing a document the firm has unpublished is
    // not something an earlier share licenses.
    wire({
      tables: {
        rooms: ROOMS,
        entries: ENTRIES,
        documents: [{ ...DOCS[0], status: "draft" }],
      },
      sharedReads: [[live("d1", "already")]],
    });

    expect(await shareDocumentInMeeting(INPUT)).toEqual({ ok: false, reason: "not-shareable" });
  });
});

describe("refusals", () => {
  it("refuses a document that is not published to any live room", async () => {
    wire({ tables: { rooms: ROOMS, entries: [], documents: DOCS } });
    expect(await shareDocumentInMeeting(INPUT)).toEqual({ ok: false, reason: "not-shareable" });
    expect(insertShare).not.toHaveBeenCalled();
  });

  it("refuses a published document with nothing behind it", async () => {
    wire({
      tables: {
        rooms: ROOMS,
        entries: ENTRIES,
        documents: [{ ...DOCS[0], storage_key: null, content: null }],
      },
    });
    expect(await shareDocumentInMeeting(INPUT)).toEqual({ ok: false, reason: "not-shareable" });
  });

  it("reports a mint the write policy refused, rather than a half-share", async () => {
    insertShare.mockResolvedValue(null);
    wire({ tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS } });

    expect(await shareDocumentInMeeting(INPUT)).toEqual({ ok: false, reason: "mint-failed" });
    expect(inserts).toEqual([]);
  });
});

describe("losing the race on the unique index", () => {
  it("returns the winner's link and revokes its own", async () => {
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      // First read: nothing, so this call mints. Second read, after the insert
      // is refused: the other call's row.
      sharedReads: [
        [],
        [live("d1", "winner")],
      ],
      insertError: { message: "duplicate key value violates unique constraint" },
    });

    const out = await shareDocumentInMeeting(INPUT);

    expect(out).toEqual({
      ok: true,
      url: "https://app.test/dataroom/winner",
      documentName: "Investor Deck",
      alreadyShared: true,
    });
    expect(updates).toEqual([
      {
        table: "data_room_shares",
        id: "share-1",
        // The caller's own client: that table has `is_org_writer`, and they
        // just minted through it. Only the join table needs the service role.
        via: "authed",
        row: { revoked_at: new Date(INPUT.now).toISOString() },
      },
    ]);
  });

  it("revokes the orphan even when the failure was not a race", async () => {
    // Nothing recorded it and nothing ever will, so the link we minted is
    // unreferenced. It is revoked on this path too, before the failure returns.
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      sharedReads: [[], []],
      insertError: { message: "connection reset" },
    });

    expect(await shareDocumentInMeeting(INPUT)).toEqual({ ok: false, reason: "record-failed" });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("share-1");
  });
});

describe("the join row is written as the service role", () => {
  // The bug this catches: `live_meeting_shared_documents` has RLS on and a
  // SELECT policy and nothing else, deliberately, because writes come through
  // this path after the caller has been authorized. The function was written
  // against the RLS-bound client, so every insert was refused by the absent
  // INSERT policy -- the link minted, the row did not record, and the caller
  // got `record-failed` on the happy path. The feature did not work at all.
  //
  // It was invisible to the first version of these tests because they pointed
  // both clients at one mock.
  it("inserts through the service client, not the caller's", async () => {
    wire({ tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS } });
    await shareDocumentInMeeting(INPUT);

    const join = inserts.filter((i) => i.table === "live_meeting_shared_documents");
    expect(join).toHaveLength(1);
    expect(join[0].via).toBe("service");
  });

  it("mints the share through the CALLER's client, so is_org_writer still applies", async () => {
    // The other half of the same decision. Elevating this one would silently
    // delete the check that stops a reader-role member handing out the firm's
    // materials.
    wire({ tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS } });
    await shareDocumentInMeeting(INPUT);

    // Identity comparison will not do -- `createServerClient` hands back a
    // fresh object per call. Ask the client it was given to route a query and
    // see which mock answers.
    const [client] = insertShare.mock.calls[0] as [{ from: (t: string) => unknown }];
    from.mockClear();
    serviceFrom.mockClear();
    client.from("probe");
    expect(from).toHaveBeenCalledWith("probe");
    expect(serviceFrom).not.toHaveBeenCalled();
  });
});

describe("a link that no longer opens", () => {
  // The second bug: `loadSharedInMeeting` kept every row whose share existed,
  // without reading `revoked_at` or `expires_at`. A revoked or expired link was
  // returned as the meeting's current one, the panel offered "Send again" on a
  // URL that does not open, and the unique index on (meeting_id, document_id)
  // then refused every attempt to mint a replacement. The host could not share
  // that document in that meeting again, ever.

  it("is left out of what the panel is told has been shared", async () => {
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      sharedReads: [[revoked("d1", "dead"), live("d2", "good")]],
    });
    const shared = await loadSharedInMeeting("m1", INPUT.now);
    expect(shared.map((s) => s.documentId)).toEqual(["d2"]);
  });

  it("counts an expiry that has passed, not only a revocation", async () => {
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      // Expiry is 2026-09-10; the clock is 2026-10-01.
      sharedReads: [[expired("d1", "stale")]],
    });
    expect(await loadSharedInMeeting("m1", INPUT.now)).toEqual([]);
  });

  it("keeps a link whose expiry is still ahead", async () => {
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      sharedReads: [[{
        ...live("d1", "fresh"),
        data_room_shares: { token: "fresh", expires_at: "2026-10-20T00:00:00.000Z", revoked_at: null },
      }]],
    });
    expect((await loadSharedInMeeting("m1", INPUT.now)).map((s) => s.url))
      .toEqual(["https://app.test/dataroom/fresh"]);
  });

  it("mints a replacement and REPOINTS the row rather than being blocked by it", async () => {
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      sharedReads: [[revoked("d1", "dead")]],
    });

    const out = await shareDocumentInMeeting(INPUT);

    expect(out).toEqual({
      ok: true,
      url: "https://app.test/dataroom/tok1",
      documentName: "Investor Deck",
      // Not `alreadyShared`: what the room is being handed is a new link.
      alreadyShared: false,
    });
    // An insert would have lost to the unique index. The row is updated, so the
    // index's one-row-per-document guarantee still holds.
    expect(inserts.filter((i) => i.table === "live_meeting_shared_documents")).toEqual([]);
    expect(updates).toEqual([
      {
        table: "live_meeting_shared_documents",
        id: "row-d1",
        via: "service",
        row: { share_id: "share-1", shared_by: "user-1" },
      },
    ]);
  });

  it("does not repoint a row whose link is still live", async () => {
    // The ordinary second tap. Nothing is minted and nothing is written.
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      sharedReads: [[live("d1", "already")]],
    });

    const out = await shareDocumentInMeeting(INPUT);

    expect(out).toEqual({
      ok: true,
      url: "https://app.test/dataroom/already",
      documentName: "Investor Deck",
      alreadyShared: true,
    });
    expect(insertShare).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("still refuses to repoint for a document that has since been unpublished", async () => {
    wire({
      tables: {
        rooms: ROOMS,
        entries: ENTRIES,
        documents: [{ ...DOCS[0], status: "draft" }],
      },
      sharedReads: [[revoked("d1", "dead")]],
    });
    expect(await shareDocumentInMeeting(INPUT)).toEqual({ ok: false, reason: "not-shareable" });
    expect(insertShare).not.toHaveBeenCalled();
  });

  it("reports a repoint that failed, rather than announcing an unrecorded link", async () => {
    wire({
      tables: { rooms: ROOMS, entries: ENTRIES, documents: DOCS },
      sharedReads: [[revoked("d1", "dead")], [revoked("d1", "dead")]],
      updateError: { message: "write refused" },
    });
    expect(await shareDocumentInMeeting(INPUT)).toEqual({ ok: false, reason: "record-failed" });
  });
});
