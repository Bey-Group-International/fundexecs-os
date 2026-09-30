import { planRoomOrganization, type OrganizerDoc } from "./earn-room-organizer";

const label = (k: string) => k.toUpperCase();
const doc = (over: Partial<OrganizerDoc>): OrganizerDoc => ({
  id: "d",
  name: "Doc",
  section: "marketing",
  status: "ready",
  hasBody: true,
  ...over,
});

describe("planRoomOrganization", () => {
  it("proposes publishing ready documents that are not in the room", () => {
    const items = planRoomOrganization({ library: [doc({ id: "a" })], publishedIds: new Set(), reviews: [], sectionLabel: label });
    expect(items).toEqual([expect.objectContaining({ kind: "publish", docId: "a" })]);
  });

  it("never proposes publishing drafts, empty documents, or ones with blockers", () => {
    const items = planRoomOrganization({
      library: [doc({ id: "a", status: "draft" }), doc({ id: "b", hasBody: false }), doc({ id: "c" })],
      publishedIds: new Set(),
      reviews: [
        { document_id: "c", suggested_section: null, recommendations: [{ severity: "blocker", title: "t", detail: "d" }] },
      ],
      sectionLabel: label,
    });
    expect(items).toEqual([]);
  });

  it("proposes withdrawing a published document that is unfinished, ahead of everything else", () => {
    const items = planRoomOrganization({
      library: [doc({ id: "a" }), doc({ id: "b", status: "review" })],
      publishedIds: new Set(["b"]),
      reviews: [],
      sectionLabel: label,
    });
    expect(items.map((i) => `${i.kind}:${i.docId}`)).toEqual(["hold:b", "publish:a"]);
  });

  it("proposes refiling where Earn's review disagrees with the section", () => {
    const items = planRoomOrganization({
      library: [doc({ id: "a", section: "other" })],
      publishedIds: new Set(["a"]),
      reviews: [{ document_id: "a", suggested_section: "fund_terms", recommendations: [] }],
      sectionLabel: label,
    });
    expect(items).toEqual([expect.objectContaining({ kind: "refile", from: "other", to: "fund_terms" })]);
  });
});
