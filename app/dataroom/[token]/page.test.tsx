/**
 * What a reader is told. A failed read is not a dead link: a reader with a good
 * link must not be sent off to ask for a new one because the database hiccuped.
 */
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/email", () => ({ escapeHtml: (s: string) => s, sendEmail: jest.fn() }));
jest.mock("@/components/dataroom/DataRoomViewer", () => ({
  DataRoomViewer: (p: { docSections: { docs: { id: string }[] }[] }) => (
    <div data-testid="viewer">{p.docSections.flatMap((s) => s.docs).length} documents</div>
  ),
}));
jest.mock("@/lib/data-room-gate", () => ({ readGatePass: async () => null, gateSatisfied: () => true }));

import { render, screen } from "@testing-library/react";
import { fakeDb, type Row } from "../../../test-utils/fake-supabase";

let db: ReturnType<typeof fakeDb>;
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => db.client,
}));

import PublicDataRoom from "./page";

const ORG = "org-1";
const tables = (over: Record<string, Row[]> = {}): Record<string, Row[]> => ({
  data_room_shares: [{ id: "s1", token: "tok", organization_id: ORG, room_id: "room-1", revoked_at: null, expires_at: null, allowed_sections: null, document_id: null, password_hash: null }],
  data_rooms: [{ id: "room-1", organization_id: ORG, archived_at: null }],
  organizations: [{ id: ORG, name: "Alpha Capital" }],
  investment_theses: [],
  track_records: [],
  entities: [],
  organization_members: [],
  principals: [],
  data_room_views: [],
  data_room_document_signatures: [],
  data_room_documents: [{ organization_id: ORG, room_id: "room-1", document_id: "d1", sort_order: 0, require_signature: false }],
  documents: [{ id: "d1", organization_id: ORG, name: "Deck", doc_type: "marketing", content: "x", storage_key: null }],
  ...over,
});

async function open(token = "tok") {
  const el = await PublicDataRoom({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) });
  render(el);
}

let errorLog: jest.SpyInstance;
beforeEach(() => {
  errorLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

describe("the public data room page", () => {
  it("shows the room for a good link", async () => {
    db = fakeDb(tables());
    await open();
    expect(screen.getByTestId("viewer")).toHaveTextContent("1 documents");
  });

  it("says the link is not available when it is revoked, expired or unknown", async () => {
    db = fakeDb(tables());
    await open("no-such-token");
    expect(screen.getByRole("heading")).toHaveTextContent("isn't available");
  });

  it("says the link is fine, and to try again, when the link can't be looked up", async () => {
    db = fakeDb(tables());
    db.fail["data_room_shares"] = "08006";
    await open();
    expect(screen.getByRole("heading")).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.getByText(/link is fine/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid, has expired/i)).toBeNull();
  });

  it("says the same when the room's documents can't be read, rather than showing an empty room", async () => {
    db = fakeDb(tables());
    db.fail["documents"] = "08006";
    await open();
    expect(screen.getByRole("heading")).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.queryByTestId("viewer")).toBeNull();
  });

  it("logs the failure without any of the request in the line", async () => {
    db = fakeDb(tables());
    db.fail["documents"] = "08006";
    await open();
    expect(errorLog).toHaveBeenCalledWith("[data-room] read failed", "documents", "08006");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("tok");
  });

  it("does not swallow a failure that is not a read failure", async () => {
    db = fakeDb(tables());
    (db.client as unknown as { from: () => never }).from = () => {
      throw new Error("a bug, not an outage");
    };
    await expect(open()).rejects.toThrow("a bug, not an outage");
  });
});
