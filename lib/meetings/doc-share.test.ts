// lib/meetings/doc-share.test.ts
import {
  DOC_SHARE_EXPIRY_DAYS,
  blockedLabel,
  docShareChatText,
  docShareExpiresAt,
  docShareLabel,
  groupMeetingDocs,
  searchMeetingDocs,
  shareableDocuments,
  sharedUrlFor,
  type DocShareDocument,
  type DocShareEntry,
  type DocShareRoom,
} from "@/lib/meetings/doc-share";

const ROOMS: DocShareRoom[] = [
  { id: "room-default", name: "Primary Data Room", isDefault: true },
  { id: "room-atlas", name: "Co-invest — Atlas", isDefault: false },
];

function doc(over: Partial<DocShareDocument> & { id: string }): DocShareDocument {
  return {
    name: over.id,
    section: "marketing",
    status: "ready",
    hasFile: true,
    hasContent: false,
    ...over,
  };
}

function entry(documentId: string, roomId = "room-default", sortOrder = 0): DocShareEntry {
  return { roomId, documentId, sortOrder };
}

describe("shareableDocuments", () => {
  it("offers a published, ready, non-empty document", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", name: "Investor Deck" })],
    });
    expect(out).toEqual([
      {
        id: "d1",
        name: "Investor Deck",
        section: "marketing",
        sectionLabel: "Marketing & Materials",
        roomId: "room-default",
        roomName: "Primary Data Room",
        blocked: null,
      },
    ]);
  });

  it("blocks a draft rather than hiding it", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", status: "draft" })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].blocked).toBe("not-ready");
  });

  it("blocks a document in review", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", status: "review" })],
    });
    expect(out[0].blocked).toBe("not-ready");
  });

  it("treats an unrecognised status as not ready", () => {
    // A status this build has never heard of is not a licence to hand the
    // document to an LP.
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", status: "archived" })],
    });
    expect(out[0].blocked).toBe("not-ready");
  });

  it("treats a null status as ready, matching the column default", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", status: null })],
    });
    expect(out[0].blocked).toBeNull();
  });

  it("blocks a document with neither a file nor inline content", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", hasFile: false, hasContent: false })],
    });
    expect(out[0].blocked).toBe("empty");
  });

  it("offers one backed only by inline content", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", hasFile: false, hasContent: true })],
    });
    expect(out[0].blocked).toBeNull();
  });

  it("reports not-ready ahead of empty when both are true", () => {
    // Both would be accurate; the publish state is the one the host can act on
    // and the one the data room itself is enforcing.
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", status: "draft", hasFile: false, hasContent: false })],
    });
    expect(out[0].blocked).toBe("not-ready");
  });

  it("offers a document published into several rooms exactly once", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1", "room-atlas"), entry("d1", "room-default")],
      documents: [doc({ id: "d1" })],
    });
    expect(out).toHaveLength(1);
  });

  it("attributes it to the default room whichever order the manifest arrives in", () => {
    const forward = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1", "room-atlas"), entry("d1", "room-default")],
      documents: [doc({ id: "d1" })],
    });
    const reverse = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1", "room-default"), entry("d1", "room-atlas")],
      documents: [doc({ id: "d1" })],
    });
    expect(forward[0].roomId).toBe("room-default");
    expect(reverse[0].roomId).toBe("room-default");
  });

  it("falls back to the earliest room when no room is the default", () => {
    const rooms: DocShareRoom[] = [
      { id: "room-a", name: "A", isDefault: false },
      { id: "room-b", name: "B", isDefault: false },
    ];
    const out = shareableDocuments({
      rooms,
      entries: [entry("d1", "room-b"), entry("d1", "room-a")],
      documents: [doc({ id: "d1" })],
    });
    expect(out[0].roomId).toBe("room-a");
  });

  it("drops a manifest row whose room is archived, so no longer listed", () => {
    const out = shareableDocuments({
      rooms: [ROOMS[0]],
      entries: [entry("d1", "room-archived")],
      documents: [doc({ id: "d1" })],
    });
    expect(out).toEqual([]);
  });

  it("drops a manifest row whose document is gone", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("missing")],
      documents: [],
    });
    expect(out).toEqual([]);
  });

  it("keeps the document in the default room when the archived room was the other publisher", () => {
    const out = shareableDocuments({
      rooms: [ROOMS[0]],
      entries: [entry("d1", "room-archived"), entry("d1", "room-default")],
      documents: [doc({ id: "d1" })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].roomId).toBe("room-default");
  });

  it("orders by section as the data room orders sections, not alphabetically", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("terms"), entry("overview"), entry("thesis")],
      documents: [
        doc({ id: "terms", section: "fund_terms" }),
        doc({ id: "overview", section: "overview" }),
        doc({ id: "thesis", section: "thesis" }),
      ],
    });
    // "Firm Overview" < "Investment Strategy & Thesis" < "Fund Terms" by the
    // room's order; alphabetical labels would have put Fund Terms first.
    expect(out.map((d) => d.id)).toEqual(["overview", "thesis", "terms"]);
  });

  it("files an unknown section last", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("weird"), entry("deck")],
      documents: [
        doc({ id: "weird", section: "not_a_section" }),
        doc({ id: "deck", section: "marketing" }),
      ],
    });
    expect(out.map((d) => d.id)).toEqual(["deck", "weird"]);
  });

  it("files a null section under the catch-all", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("d1")],
      documents: [doc({ id: "d1", section: null })],
    });
    expect(out[0].section).toBe("other");
    expect(out[0].sectionLabel).toBe("Other Materials");
  });

  it("orders within a section by the manifest's sort order", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("b", "room-default", 2), entry("a", "room-default", 1)],
      documents: [doc({ id: "a", name: "Zulu" }), doc({ id: "b", name: "Alpha" })],
    });
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("breaks an equal sort order by name", () => {
    const out = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("b", "room-default", 0), entry("a", "room-default", 0)],
      documents: [doc({ id: "a", name: "Zulu" }), doc({ id: "b", name: "Alpha" })],
    });
    expect(out.map((d) => d.name)).toEqual(["Alpha", "Zulu"]);
  });
});

describe("searchMeetingDocs", () => {
  const docs = shareableDocuments({
    rooms: ROOMS,
    entries: [entry("ddq", "room-atlas"), entry("fin", "room-default"), entry("fonc", "room-default")],
    documents: [
      doc({ id: "ddq", name: "ILPA DDQ 2026", section: "diligence" }),
      doc({ id: "fin", name: "Audited Financials", section: "financials" }),
      doc({ id: "fonc", name: "Foncière Review", section: "financials" }),
    ],
  });

  it("returns everything for an empty query", () => {
    expect(searchMeetingDocs(docs, "")).toHaveLength(3);
    expect(searchMeetingDocs(docs, "   ")).toHaveLength(3);
  });

  it("matches the document name", () => {
    expect(searchMeetingDocs(docs, "ddq").map((d) => d.id)).toEqual(["ddq"]);
  });

  it("matches the section label", () => {
    expect(searchMeetingDocs(docs, "diligence").map((d) => d.id)).toEqual(["ddq"]);
  });

  it("matches the room name", () => {
    expect(searchMeetingDocs(docs, "atlas").map((d) => d.id)).toEqual(["ddq"]);
  });

  it("requires every term to match, so room plus name narrows", () => {
    expect(searchMeetingDocs(docs, "atlas ddq").map((d) => d.id)).toEqual(["ddq"]);
    expect(searchMeetingDocs(docs, "atlas financials")).toEqual([]);
  });

  it("ignores accents, so the host need not reproduce one they can see", () => {
    expect(searchMeetingDocs(docs, "fonciere").map((d) => d.id)).toEqual(["fonc"]);
    expect(searchMeetingDocs(docs, "FONCIÈRE").map((d) => d.id)).toEqual(["fonc"]);
  });

  it("does not mutate or alias the input", () => {
    const all = searchMeetingDocs(docs, "");
    all.pop();
    expect(docs).toHaveLength(3);
  });
});

describe("groupMeetingDocs", () => {
  it("groups by section in the room's order, with labels", () => {
    const docs = shareableDocuments({
      rooms: ROOMS,
      entries: [entry("fin"), entry("deck"), entry("fin2")],
      documents: [
        doc({ id: "fin", section: "financials", name: "A" }),
        doc({ id: "deck", section: "marketing", name: "B" }),
        doc({ id: "fin2", section: "financials", name: "C" }),
      ],
    });
    expect(groupMeetingDocs(docs)).toEqual([
      { key: "marketing", label: "Marketing & Materials", docs: [expect.objectContaining({ id: "deck" })] },
      {
        key: "financials",
        label: "Financials & Audits",
        docs: [expect.objectContaining({ id: "fin" }), expect.objectContaining({ id: "fin2" })],
      },
    ]);
  });

  it("is empty for no documents", () => {
    expect(groupMeetingDocs([])).toEqual([]);
  });
});

describe("docShareLabel", () => {
  it("names the occasion so the Shares list can explain itself", () => {
    expect(docShareLabel("Q3 LP Update")).toBe("Shared in: Q3 LP Update");
  });

  it("falls back when the meeting has no title", () => {
    expect(docShareLabel(null)).toBe("Shared in a meeting");
    expect(docShareLabel("   ")).toBe("Shared in a meeting");
    expect(docShareLabel(undefined)).toBe("Shared in a meeting");
  });

  it("collapses whitespace, including newlines a pasted title carries", () => {
    expect(docShareLabel("Q3\n\nLP   Update")).toBe("Shared in: Q3 LP Update");
  });

  it("bounds a title that reaches an email subject and the audit CSV", () => {
    expect(docShareLabel("x".repeat(500))).toHaveLength(120);
  });
});

describe("docShareExpiresAt", () => {
  it("defaults to the documented window rather than to never", () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    expect(docShareExpiresAt(now)).toBe(
      new Date(now + DOC_SHARE_EXPIRY_DAYS * 86_400_000).toISOString(),
    );
  });

  it("accepts an explicit window", () => {
    const now = Date.UTC(2026, 9, 1);
    expect(docShareExpiresAt(now, 1)).toBe(new Date(Date.UTC(2026, 9, 2)).toISOString());
  });
});

describe("docShareChatText", () => {
  it("carries a bare URL the chat's own linkifier will pick up", () => {
    const text = docShareChatText({
      documentName: "Investor Deck",
      url: "https://app.fundexecs.com/dataroom/abc123",
    });
    expect(text).toBe("📄 Investor Deck — https://app.fundexecs.com/dataroom/abc123");
  });

  it("flattens a name that would push the URL out of the bubble", () => {
    const text = docShareChatText({ documentName: "Deck\nv2", url: "https://x.test/a" });
    expect(text).toBe("📄 Deck v2 — https://x.test/a");
  });

  it("still names something when the document has no name", () => {
    expect(docShareChatText({ documentName: "  ", url: "https://x.test/a" })).toBe(
      "📄 Document — https://x.test/a",
    );
  });
});

describe("sharedUrlFor", () => {
  const shared = [{ documentId: "d1", url: "https://x.test/1" }];

  it("finds the link already minted for this meeting", () => {
    expect(sharedUrlFor(shared, "d1")).toBe("https://x.test/1");
  });

  it("is null for a document not yet shared", () => {
    expect(sharedUrlFor(shared, "d2")).toBeNull();
    expect(sharedUrlFor([], "d1")).toBeNull();
  });
});

describe("blockedLabel", () => {
  it("says why, in words a host can act on", () => {
    expect(blockedLabel("not-ready")).toMatch(/draft|review/i);
    expect(blockedLabel("empty")).toMatch(/attached/i);
  });
});
