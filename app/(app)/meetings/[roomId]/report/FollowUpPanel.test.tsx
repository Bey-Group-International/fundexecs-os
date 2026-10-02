/**
 * The follow-up panel's two buttons, and the difference between them.
 *
 * One reaches everyone who was in the room the moment it is pressed. The other
 * puts the same words on those people's inbox threads for somebody to send. They
 * take the same text from the same textarea and sit two inches apart, so the
 * property worth a test is that each goes where it says it goes — and that the
 * draft's confirmation can never be mistaken for a send.
 *
 * There was no test file here at all before this: the panel shipped with a Send
 * button and nothing asserting where it posted.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FollowUpPanel } from "./FollowUpPanel";

const DRAFT = "Hi all,\n\nGood meeting.\n\n— Host";

/** Records every request so the URL and the body can both be inspected. */
function captureFetch(response: Record<string, unknown> = { sent: 1, total: 1 }, ok = true) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = jest.fn(async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok, json: async () => response } as unknown as Response;
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return calls;
}

function panel(canSend = true) {
  return render(<FollowUpPanel meetingId="m1" draft={DRAFT} canSend={canSend} />);
}

afterEach(() => {
  jest.resetAllMocks();
});

describe("who sees the actions", () => {
  it("offers both to the host", () => {
    panel();
    expect(screen.getByRole("button", { name: /draft in inbox/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send now/i })).toBeInTheDocument();
  });

  // The follow-up goes out over the host's name, from the host's mailbox, to
  // everyone in the room. Neither half of that is somebody else's to do.
  it("offers neither to anyone else, but still shows the draft", () => {
    panel(false);
    expect(screen.queryByRole("button", { name: /draft in inbox/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /send now/i })).toBeNull();
    expect(screen.getByText(/Good meeting/)).toBeInTheDocument();
  });
});

describe("drafting", () => {
  it("posts to the draft route, not the send route", async () => {
    const calls = captureFetch({ drafted: 1, message: "Drafted. Nothing has been sent." });
    panel();

    await userEvent.click(screen.getByRole("button", { name: /draft in inbox/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/meetings/m1/follow-up/draft");
  });

  // The host can edit before either action, and the edit is the thing they meant.
  it("carries the edited text rather than the stored draft", async () => {
    const calls = captureFetch({ drafted: 1, message: "ok" });
    panel();

    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const field = screen.getByRole("textbox");
    await userEvent.clear(field);
    await userEvent.type(field, "Rewritten.");
    await userEvent.click(screen.getByRole("button", { name: /draft in inbox/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ body: "Rewritten." });
  });

  /**
   * The route's own wording, shown as it came. The panel must not summarise it
   * into something shorter that drops the "nothing has been sent" — that sentence
   * is the whole difference between the two buttons.
   */
  it("reports what the route said, and offers the inbox", async () => {
    captureFetch({ drafted: 2, message: "Drafted in the inbox for 2 people. Nothing has been sent — open the inbox to send it." });
    panel();

    await userEvent.click(screen.getByRole("button", { name: /draft in inbox/i }));

    await waitFor(() =>
      expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /open inbox/i })).toHaveAttribute("href", "/inbox");
  });

  it("never claims a send", async () => {
    captureFetch({ drafted: 1, message: "Drafted in the inbox for 1 person. Nothing has been sent — open the inbox to send it." });
    panel();

    await userEvent.click(screen.getByRole("button", { name: /draft in inbox/i }));

    await waitFor(() => expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument());
    // "Sent to 1 attendee" is what the send path says. Drafting must not.
    expect(screen.queryByText(/^Sent to/)).toBeNull();
  });

  it("says so when the draft could not be written", async () => {
    captureFetch({ error: "This meeting does not belong to your organisation's inbox." }, false);
    panel();

    await userEvent.click(screen.getByRole("button", { name: /draft in inbox/i }));

    await waitFor(() =>
      expect(screen.getByText(/does not belong to your organisation/)).toBeInTheDocument(),
    );
  });
});

describe("sending", () => {
  it("still posts to the send route", async () => {
    const calls = captureFetch({ sent: 1, total: 1, unreachable: [], failed: [] });
    panel();

    await userEvent.click(screen.getByRole("button", { name: /send now/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/meetings/m1/follow-up");
  });

  it("reports the delivery, which is a different sentence entirely", async () => {
    captureFetch({ sent: 2, total: 2, unreachable: [], failed: [] });
    panel();

    await userEvent.click(screen.getByRole("button", { name: /send now/i }));

    await waitFor(() => expect(screen.queryByText(/Nothing has been sent/)).toBeNull());
    expect(screen.getByRole("button", { name: /send again/i })).toBeInTheDocument();
  });
});

/**
 * One in-flight action at a time.
 *
 * Both buttons post the textarea's contents. Leaving the other enabled means a
 * host who presses Draft and then Send — which is a reasonable thing to do
 * quickly — can have the send land while the draft is still being written, so the
 * inbox ends up holding a draft of a message that has already gone out.
 */
describe("while one is in flight", () => {
  it("disables the other", async () => {
    let release: (() => void) | null = null;
    (global as unknown as { fetch: unknown }).fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => ({ drafted: 1, message: "ok" }) } as Response);
        }),
    );
    panel();

    await userEvent.click(screen.getByRole("button", { name: /draft in inbox/i }));

    expect(screen.getByRole("button", { name: /drafting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send now/i })).toBeDisabled();

    release!();
  });
});

describe("before anything is sent", () => {
  const recipients = [
    { name: "Jane Doe", email: "jane@lp.test", role: "invitee" as const, attended: true, receivesFollowUp: true },
    { name: "Mark Lee", email: "mark@fund.test", role: "attendee" as const, attended: true, receivesFollowUp: true },
  ];
  const draft = "Hi {{first_name}},\n\n**Thanks** for today.\n\n1. Send deck\n2. Book call";

  function full() {
    return render(
      <FollowUpPanel
        meetingId="m1"
        draft={draft}
        canSend
        recipients={recipients}
        unreachable={["Guest"]}
        hostName="Alex Rivera"
        status={{ kind: "not_sent" }}
      />,
    );
  }

  it("names who it goes to, in their roles, and who it cannot reach", () => {
    full();
    expect(screen.getByText("Invitee")).toBeInTheDocument();
    expect(screen.getByText("Attendee")).toBeInTheDocument();
    expect(screen.getByText(/No email address for Guest/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send now to 2/i })).toBeInTheDocument();
  });

  it("shows where the follow-up stands", () => {
    full();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
  });

  it("previews each recipient's own copy, formatted", async () => {
    full();
    expect(screen.getByText("Hi Jane,")).toBeInTheDocument();
    expect(screen.getByText("Thanks").tagName).toBe("STRONG");
    expect(screen.getByText("Send deck").tagName).toBe("LI");

    await userEvent.selectOptions(screen.getByLabelText(/preview as/i), "1");
    expect(screen.getByText("Hi Mark,")).toBeInTheDocument();
  });

  it("formats from the toolbar", async () => {
    full();
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.clear(field);
    await userEvent.type(field, "deck");
    field.setSelectionRange(0, 4);
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(field.value).toBe("**deck**");
  });
});
