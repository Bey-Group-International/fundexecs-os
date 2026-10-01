/**
 * The in-call data-room picker.
 *
 * The cases worth holding are the ones where getting it wrong costs something
 * irreversible or inexplicable:
 *
 *   a draft must never carry a Share button, because the one thing this panel
 *   must not make easy is handing an LP an unfinished document;
 *
 *   a refusal must say so in words, because an empty list and "you are not a
 *   member of this firm" look identical and lead the host to tap at nothing;
 *
 *   a second tap must not mint a second link, and the panel's half of that is
 *   re-announcing the link it holds without going back to the server;
 *
 *   the announcement must be the pure function's text, so what the room sees
 *   and what the export records cannot drift from each other.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeetingDocsPanel } from "./MeetingDocsPanel";
import { DOC_SHARE_EXPIRY_DAYS, docShareChatText, type MeetingDoc } from "@/lib/meetings/doc-share";

const doc = (over: Partial<MeetingDoc> & { id: string }): MeetingDoc => ({
  name: over.id,
  section: "marketing",
  sectionLabel: "Marketing & Materials",
  roomId: "room-1",
  roomName: "Primary Data Room",
  blocked: null,
  ...over,
});

const DECK = doc({ id: "d1", name: "Investor Deck" });
const DRAFT = doc({ id: "d2", name: "Half-written Memo", blocked: "not-ready" });

function mockFetch(handlers: {
  get?: () => { status?: number; body?: unknown };
  post?: () => { status?: number; body?: unknown };
}) {
  const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
    const handler = init?.method === "POST" ? handlers.post : handlers.get;
    const result = handler?.() ?? { status: 200, body: {} };
    return {
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      json: async () => result.body ?? {},
    } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MeetingDocsPanel", () => {
  it("waits for the room to resolve its meeting rather than guessing", () => {
    const fetchMock = mockFetch({});
    render(<MeetingDocsPanel meetingId={null} onShare={jest.fn()} />);
    expect(screen.getByText(/waiting for the meeting/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists what the firm can share, and says what the link will be", async () => {
    mockFetch({ get: () => ({ body: { docs: [DECK], shared: [] } }) });
    render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    expect(await screen.findByText("Investor Deck")).toBeInTheDocument();
    expect(screen.getByText("Primary Data Room")).toBeInTheDocument();
    // The link's life is stated before the first tap, not discovered afterwards.
    expect(
      screen.getByText(new RegExp(`expires in ${DOC_SHARE_EXPIRY_DAYS} days`, "i")),
    ).toBeInTheDocument();
  });

  it("gives a blocked document its reason and no Share button", async () => {
    mockFetch({ get: () => ({ body: { docs: [DECK, DRAFT], shared: [] } }) });
    render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    expect(await screen.findByText("Half-written Memo")).toBeInTheDocument();
    expect(screen.getByText(/still draft or in review/i)).toBeInTheDocument();
    // One Share button for two documents: the draft has none.
    expect(screen.getAllByRole("button", { name: /^Share$/ })).toHaveLength(1);
  });

  it("shares a document and announces the pure function's text", async () => {
    const onShare = jest.fn();
    const fetchMock = mockFetch({
      get: () => ({ body: { docs: [DECK], shared: [] } }),
      post: () => ({ body: { url: "https://x.test/dataroom/tok", documentName: "Investor Deck" } }),
    });
    render(<MeetingDocsPanel meetingId="m1" onShare={onShare} />);

    await userEvent.click(await screen.findByRole("button", { name: /^Share$/ }));

    await waitFor(() =>
      expect(onShare).toHaveBeenCalledWith(
        docShareChatText({ documentName: "Investor Deck", url: "https://x.test/dataroom/tok" }),
      ),
    );
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse((posts[0][1] as RequestInit).body as string)).toEqual({ documentId: "d1" });
  });

  it("re-announces a link it already holds without asking the server again", async () => {
    const onShare = jest.fn();
    const fetchMock = mockFetch({
      get: () => ({ body: { docs: [DECK], shared: [{ documentId: "d1", url: "https://x.test/held", sharedAt: "t" }] } }),
    });
    render(<MeetingDocsPanel meetingId="m1" onShare={onShare} />);

    // Already shared, so the button offers to send it again rather than to share.
    const button = await screen.findByRole("button", { name: /send again/i });
    expect(screen.getByText("Shared")).toBeInTheDocument();

    await userEvent.click(button);

    expect(onShare).toHaveBeenCalledWith(
      docShareChatText({ documentName: "Investor Deck", url: "https://x.test/held" }),
    );
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });

  it("does not post twice when the same document is tapped twice", async () => {
    const onShare = jest.fn();
    const fetchMock = mockFetch({
      get: () => ({ body: { docs: [DECK], shared: [] } }),
      post: () => ({ body: { url: "https://x.test/tok", documentName: "Investor Deck" } }),
    });
    render(<MeetingDocsPanel meetingId="m1" onShare={onShare} />);

    const button = await screen.findByRole("button", { name: /^Share$/ });
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: /send again/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /send again/i }));

    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
    expect(onShare).toHaveBeenCalledTimes(2);
  });

  it("says a non-member is not sharing from this firm's room, rather than showing nothing", async () => {
    mockFetch({ get: () => ({ status: 401, body: { error: "Unauthorized" } }) });
    render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    expect(await screen.findByText(/not yours to share from/i)).toBeInTheDocument();
  });

  it("offers a retry when the load fails for an ordinary reason", async () => {
    let calls = 0;
    mockFetch({
      get: () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: {} } : { body: { docs: [DECK], shared: [] } };
      },
    });
    render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Investor Deck")).toBeInTheDocument();
  });

  it("points at where to publish when nothing is published", async () => {
    mockFetch({ get: () => ({ body: { docs: [], shared: [] } }) });
    render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    expect(await screen.findByText(/nothing is published to a data room/i)).toBeInTheDocument();
  });

  it("carries the server's own refusal rather than a generic failure", async () => {
    mockFetch({
      get: () => ({ body: { docs: [DECK], shared: [] } }),
      post: () => ({ status: 403, body: { error: "You may not have permission to share this firm's materials." } }),
    });
    const onShare = jest.fn();
    render(<MeetingDocsPanel meetingId="m1" onShare={onShare} />);

    await userEvent.click(await screen.findByRole("button", { name: /^Share$/ }));

    expect(await screen.findByText(/may not have permission/i)).toBeInTheDocument();
    // Nothing was announced: the room must not carry a link that does not exist.
    expect(onShare).not.toHaveBeenCalled();
  });

  it("narrows to what the host types, and says when nothing matches", async () => {
    mockFetch({
      get: () => ({
        body: {
          docs: [DECK, doc({ id: "d3", name: "Audited Financials", section: "financials", sectionLabel: "Financials & Audits" })],
          shared: [],
        },
      }),
    });
    render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    const search = await screen.findByLabelText(/search the data room/i);
    await userEvent.type(search, "financ");
    expect(screen.getByText("Audited Financials")).toBeInTheDocument();
    expect(screen.queryByText("Investor Deck")).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it("states the bound when the firm has more documents than were loaded", async () => {
    mockFetch({ get: () => ({ body: { docs: [DECK], shared: [], truncated: true } }) });
    render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    expect(await screen.findByText(/only the first/i)).toBeInTheDocument();
  });

  it("loads once, not on every render", async () => {
    const fetchMock = mockFetch({ get: () => ({ body: { docs: [DECK], shared: [] } }) });
    const { rerender } = render(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);
    await screen.findByText("Investor Deck");

    // The room re-renders several times a second while anyone is talking. None
    // of those may re-fetch the firm's materials.
    for (let i = 0; i < 5; i += 1) rerender(<MeetingDocsPanel meetingId="m1" onShare={jest.fn()} />);

    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method !== "POST")).toHaveLength(1);
  });
});
