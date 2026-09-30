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
/** The draft revision the composer opened on — its `updated_at`. */
const REVISION = "2026-09-30T12:00:00.000Z";

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
  const onResult = jest.fn();
  const view = render(<ThreadConversation card={card(over)} onResult={onResult} />);
  return {
    ...view,
    /** Re-render with new props, as a router.refresh() or InboxLive update would. */
    withCard: (next: Partial<ThreadConversationCard>) =>
      view.rerender(<ThreadConversation card={card(next)} onResult={onResult} />),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getThreadMessages.mockResolvedValue([]);
  suggestSmartReplies.mockResolvedValue({ ok: true, live: false });
  replyToThread.mockResolvedValue({ ok: true, message: "Queued." });
});

describe("a thread with a draft waiting", () => {
  it("opens with the draft already in the composer", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent.", revision: REVISION } });
    expect(await screen.findByRole("textbox")).toHaveValue(DRAFT_BODY);
  });

  it("says where it came from, and that it has not gone anywhere", () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent.", revision: REVISION } });
    expect(screen.getByText(/Drafted from a meeting report/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument();
  });

  /**
   * The line this whole design exists to hold. Seeding a composer is one keystroke
   * from seeding and submitting it, and the report drafts rather than sends
   * precisely so that keystroke belongs to a person.
   */
  it("sends nothing by opening", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Nothing has been sent.", revision: REVISION } });
    await waitFor(() => expect(getThreadMessages).toHaveBeenCalled());
    expect(replyToThread).not.toHaveBeenCalled();
  });

  // The chips replace whatever is in the composer, so offering them over a draft
  // would put a one-tap "Thanks — following up shortly." on top of the follow-up.
  it("does not offer the one-tap openers over it", () => {
    panel({ draft: { body: DRAFT_BODY, origin: "x", revision: REVISION } });
    expect(screen.queryByRole("button", { name: /following up shortly/i })).toBeNull();
  });

  it("sends exactly what is in the composer when the operator presses send", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "x", revision: REVISION } });
    await userEvent.click(await screen.findByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("thread_id")).toBe("t1");
    expect(form.get("body")).toBe(DRAFT_BODY);
  });

  /**
   * And says WHICH draft it was composed from.
   *
   * Without this the server deletes by thread alone, so sending a draft the report
   * has since replaced destroys the replacement — a draft nobody ever saw. Dropping
   * this one `f.set` passed every other test in this file, which is the third time
   * in this area that a rule was covered and the line feeding it was not.
   */
  it("tells the server which draft revision it opened on", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "x", revision: REVISION } });
    await userEvent.click(await screen.findByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("draft_revision")).toBe(REVISION);
  });

  /**
   * The row is deleted server-side by replyToThread. This is the same fact in the
   * panel that is still open — without it the operator watches "nothing has been
   * sent" sit under a reply that has just gone.
   */
  it("stops saying a draft is waiting once the reply goes", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent.", revision: REVISION } });
    await userEvent.click(await screen.findByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(screen.queryByText(/Nothing has been sent/)).toBeNull());
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  // A failed send leaves both, because the text is the only copy the operator has
  // left and the draft is still genuinely unsent.
  it("keeps the draft and the note when the send fails", async () => {
    replyToThread.mockResolvedValue({ ok: false, error: "The mailbox is not connected." });
    panel({ draft: { body: DRAFT_BODY, origin: "Drafted from a meeting report. Nothing has been sent.", revision: REVISION } });
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

  // Nothing to identify, so nothing is sent — and the server then clears nothing,
  // which is the safe direction.
  it("sends no revision when there is no draft", async () => {
    panel();
    const field = await screen.findByRole("textbox");
    await userEvent.type(field, "Typed from scratch.");
    await userEvent.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("draft_revision")).toBeNull();
  });

  it("still offers the one-tap openers", async () => {
    panel();
    expect(
      await screen.findByRole("button", { name: /following up shortly/i }),
    ).toBeInTheDocument();
  });
});

/**
 * Which draft revision a send actually claims.
 *
 * The revision identifies THE TEXT BEING SENT, not the newest draft on the thread.
 * These are separate facts, and an earlier version conflated them: it read the
 * revision off `card.draft` at send time, so a refresh that replaced the prop with
 * a newer draft paired the NEW revision with the OLD composer text — and the server
 * then deleted a draft nobody had seen. The lost update the revision guard exists to
 * prevent, reintroduced by the guard's own client half.
 *
 * `replyText` is seeded on mount, the panel stays mounted while its card is
 * collapsed, and the card is keyed by thread id — so that prop change is ordinary,
 * not exotic.
 */
describe("the revision follows the text, not the thread", () => {
  const NEWER = "2026-09-30T18:00:00.000Z";

  it("sends the revision it was seeded with, even after a newer draft arrives", async () => {
    const view = panel({ draft: { body: DRAFT_BODY, origin: "x", revision: REVISION } });
    expect(await screen.findByRole("textbox")).toHaveValue(DRAFT_BODY);

    // A refresh lands a newer draft while the composer still holds the old text.
    view.withCard({ draft: { body: "Rewritten by a later meeting.", origin: "x", revision: NEWER } });
    expect(screen.getByRole("textbox")).toHaveValue(DRAFT_BODY);

    await userEvent.click(screen.getByRole("button", { name: /send reply/i }));
    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("body")).toBe(DRAFT_BODY);
    // The OLD revision: it is the one this text came from. Sending NEWER here would
    // delete the newer draft, which is the bug.
    expect(form.get("draft_revision")).toBe(REVISION);
  });

  /**
   * A chip replaces the composer wholesale, so the seeded draft is no longer what is
   * about to be sent and must not be cleared by it.
   *
   * Reached by clearing the composer first, because the chips are deliberately hidden
   * while it holds text — asserted above. That is the only route to a chip on a thread
   * that had a draft, and it is a real one: an operator who does not want the drafted
   * follow-up clears it and taps an opener instead.
   */
  it("claims no revision once a quick-reply chip replaces the text", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "x", revision: REVISION } });
    await userEvent.clear(await screen.findByRole("textbox"));
    await userEvent.click(
      await screen.findByRole("button", { name: /following up shortly/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("draft_revision")).toBeNull();
  });

  // Same reasoning for Earn's draft: different text, so it does not stand for the
  // report's draft.
  it("claims no revision once Earn replaces the text", async () => {
    draftThreadReply.mockResolvedValue({ ok: true, draft: "Earn wrote this." });
    panel({ draft: { body: DRAFT_BODY, origin: "x", revision: REVISION } });

    await userEvent.click(await screen.findByRole("button", { name: /draft with earn/i }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Earn wrote this."));
    await userEvent.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("draft_revision")).toBeNull();
  });

  // Editing the seeded draft KEEPS the revision: that is still the operator sending
  // that draft, so clearing it on send is correct.
  it("keeps the revision when the operator edits the seeded draft", async () => {
    panel({ draft: { body: DRAFT_BODY, origin: "x", revision: REVISION } });
    const field = await screen.findByRole("textbox");
    await userEvent.type(field, " One more line.");
    await userEvent.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() => expect(replyToThread).toHaveBeenCalledTimes(1));
    const form = replyToThread.mock.calls[0][0] as FormData;
    expect(form.get("draft_revision")).toBe(REVISION);
    expect(String(form.get("body"))).toContain("One more line.");
  });
});
