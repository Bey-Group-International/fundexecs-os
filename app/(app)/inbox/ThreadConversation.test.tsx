/**
 * The draft a meeting report left on a thread, in the composer that can send it.
 *
 * There were no component tests for the inbox at all before this file. The three
 * properties here are the ones the feature is worth nothing without:
 *
 *   - the draft is IN the composer when the thread opens, not somewhere the
 *     operator has to go and find;
 *   - it says it has not been sent, because a composer pre-filled with a paragraph
 *     somebody else wrote and no explanation reads as a message already gone;
 *   - opening a thread does not send anything, ever. Seeding a composer is one
 *     keystroke away from seeding-and-submitting, and the report's whole reason for
 *     drafting instead of sending is that a person decides.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getThreadMessages = jest.fn();
const replyToThread = jest.fn();
const draftThreadReply = jest.fn();
const suggestSmartReplies = jest.fn();
const refresh = jest.fn();

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => refresh() }) }));
jest.mock("./actions", () => ({
  getThreadMessages: (...a: unknown[]) => getThreadMessages(...a),
  replyToThread: (...a: unknown[]) => replyToThread(...a),
  draftThreadReply: (...a: unknown[]) => draftThreadReply(...a),
  suggestSmartReplies: (...a: unknown[]) => suggestSmartReplies(...a),
}));

import { ThreadConversation, type ThreadConversationCard } from "./ThreadConversation";

const DRAFT_BODY = "Hi Ana,\n\nThanks for the time today.\n\n— Host";

function card(over: Partial<ThreadConversationCard> = {}): ThreadConversationCard {
  return {
    id: "t1",
    counterparty: "Ana Diaz",
    channel: "gmail",
    channelLabel: "Gmail",
    connected: true,
    quickReplies: ["Thanks — following up shortly."],
    draft: null,
    ...over,
  };
}

function panel(over: Partial<ThreadConversationCard> = {}) {
  return render(<ThreadConversation card={card(over)} onResult={jest.fn()} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  getThreadMessages.mockResolvedValue([]);
  suggestSmartReplies.mockResolvedValue({ ok: true, live: false });
  replyToThread.mockResolvedValue({ ok: true, message: "Queued." });
});

describe("a thread with a draft waiting", () => {
  it("opens with the draft already in the composer", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent." } });
    expect(await screen.findByRole("textbox")).toHaveValue(DRAFT_BODY);
  });

  it("says where it came from, and that it has not gone anywhere", () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent." } });
    expect(screen.getByText(/Drafted from a meeting report/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument();
  });

  /**
   * The line this whole design exists to hold. Seeding a composer is one keystroke
   * from seeding and submitting it, and the report drafts rather than sends
   * precisely so that keystroke belongs to a person.
   */
  it("sends nothing by opening", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Nothing has been sent." } });
    await waitFor(() => expect(getThreadMessages).toHaveBeenCalled());
    expect(replyToThread).not.toHaveBeenCalled();
  });

  // The chips replace whatever is in the composer, so offering them over a draft
  // would put a one-tap "Thanks — following up shortly." on top of the follow-up.
  it("does not offer the one-tap openers over it", () => {
    panel({ draft: { body: DRAFT_BODY, origin: "x" } });
    expect(screen.queryByRole("button", { name: /following up shortly/i })).toBeNull();
  });

  it("sends exactly what is in the composer when the operator presses send", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "x" } });
    await userEvent.click(await screen.findByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("thread_id")).toBe("t1");
    expect(form.get("body")).toBe(DRAFT_BODY);
  });

  /**
   * The row is deleted server-side by replyToThread. This is the same fact in the
   * panel that is still open — without it the operator watches "nothing has been
   * sent" sit under a reply that has just gone.
   */
  it("stops saying a draft is waiting once the reply goes", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent." } });
    await userEvent.click(await screen.findByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(screen.queryByText(/Nothing has been sent/)).toBeNull());
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  // A failed send leaves both, because the text is the only copy the operator has
  // left and the draft is still genuinely unsent.
  it("keeps the draft and the note when the send fails", async () => {
    replyToThread.mockResolvedValue({ ok: false, error: "The mailbox is not connected." });
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent." } });
    await userEvent.click(await screen.findByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalled());
    expect(screen.getByRole("textbox")).toHaveValue(DRAFT_BODY);
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument();
  });
});

describe("a thread with no draft", () => {
  it("opens empty, and says nothing about drafts", async () => {
    panel();
    expect(await screen.findByRole("textbox")).toHaveValue("");
    expect(screen.queryByText(/Nothing has been sent/)).toBeNull();
  });

  it("still offers the one-tap openers", async () => {
    panel();
    expect(
      await screen.findByRole("button", { name: /following up shortly/i }),
    ).toBeInTheDocument();
  });
});
