/**
 * The reminder and invitation wizards inside the schedule screen: they read the
 * meeting, recommend, and write their answers back into the form.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MeetingEditScreen } from "./MeetingEditScreen";

const posts: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  posts.length = 0;
  jest.useFakeTimers({ doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] });
  global.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST" || init?.method === "PATCH") {
      posts.push({ url: String(url), body: JSON.parse(init.body ?? "{}") });
      return { ok: true, status: 200, json: async () => ({ id: "m1", roomCode: "abc" }) };
    }
    if (String(url).startsWith("/api/meetings/busy")) return { ok: true, json: async () => ({ busy: [] }) };
    if (String(url).startsWith("/api/meetings/people")) {
      return { ok: true, json: async () => ({ results: [], zones: {} }) };
    }
    return { ok: false, json: async () => null };
  }) as unknown as typeof fetch;
});

afterEach(() => jest.useRealTimers());

function daysFromNow(days: number, hour = 15): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function open(initial: Record<string, unknown> = {}, mode: "create" | "edit" = "create") {
  render(
    <MeetingEditScreen
      mode={mode}
      initial={{ scheduledAt: daysFromNow(3), title: "Q3 review", ...initial }}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
}

describe("reminder wizard", () => {
  it("recommends from the meeting type and follows it until the host chooses", () => {
    open({ meetingType: "board_meeting", attendees: [{ name: "Lee", email: "lee@fund.com", type: "internal" }] });
    // Board meetings are prepared for: the day before.
    expect(screen.getByLabelText("Notification")).toHaveValue("1440");
    expect(screen.getByTestId("reminder-hint")).toHaveTextContent(/Recommended/);
  });

  it("only reminds the host while nobody else is invited", () => {
    open({ meetingType: "board_meeting" });
    expect(screen.getByLabelText("Notification")).toHaveValue("15");
    expect(screen.getByTestId("reminder-hint")).toHaveTextContent(/Nobody else is invited/);
  });

  it("walks through context, timing and a recommendation, then applies it", () => {
    open({
      attendees: [{ name: "Lee", email: "lee@lp.com", type: "external" }],
    });
    // External guest: 2 hours.
    expect(screen.getByLabelText("Notification")).toHaveValue("120");

    fireEvent.click(screen.getByRole("button", { name: "Reminder wizard" }));
    const dialog = screen.getByRole("dialog", { name: "Reminder setup" });
    expect(within(dialog).getByText("About the meeting")).toBeInTheDocument();

    // Tell it people must prepare: the recommendation moves to a day before.
    fireEvent.click(within(dialog).getByRole("radio", { name: "Yes — pre-read or prep" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText("Starts in")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getAllByText("Recommended").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("1 day before").length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole("button", { name: /Use 1 day before/i }));
    expect(screen.queryByRole("dialog", { name: "Reminder setup" })).toBeNull();
    expect(screen.getByLabelText("Notification")).toHaveValue("1440");
  });

  it("lets the host pick an alternative and stops following the recommendation", () => {
    open({ attendees: [{ name: "Lee", email: "lee@lp.com", type: "external" }] });
    fireEvent.click(screen.getByRole("button", { name: "Reminder wizard" }));
    const dialog = screen.getByRole("dialog", { name: "Reminder setup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /No reminder/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Use no reminder/i }));
    expect(screen.getByLabelText("Notification")).toHaveValue("");
    expect(screen.getByTestId("reminder-hint")).toHaveTextContent(/Suggested/);
  });

  it("does not override a saved meeting's reminder", () => {
    open({ reminderMinutes: 30, meetingId: "m9", attendees: [{ name: "Lee", email: "lee@lp.com", type: "external" }] }, "edit");
    expect(screen.getByLabelText("Notification")).toHaveValue("30");
  });

  it("closes only the wizard on Escape", () => {
    const onClose = jest.fn();
    render(<MeetingEditScreen mode="create" initial={{ scheduledAt: daysFromNow(3) }} onClose={onClose} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Reminder wizard" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Reminder setup" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Reminder setup" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("wizard keyboard handling", () => {
  it("keeps Tab inside the wizard and returns focus to its opener on close", () => {
    open();
    const opener = screen.getByRole("button", { name: "Reminder wizard" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Reminder setup" });
    const buttons = within(dialog).getAllByRole("button");
    const lastBtn = buttons[buttons.length - 1];
    lastBtn.focus();
    fireEvent.keyDown(lastBtn, { key: "Tab" });
    expect(document.activeElement).not.toBe(lastBtn);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("does not close when a control inside already used Escape", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reminder wizard" }));
    const dialog = screen.getByRole("dialog", { name: "Reminder setup" });
    const input = within(dialog).getAllByRole("button")[0];
    input.addEventListener("keydown", (e) => e.preventDefault());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Reminder setup" })).not.toBeNull();
  });
});

describe("invitation wizard", () => {
  it("blocks on an empty guest list until somebody is added", async () => {
    open();
    expect(screen.getByTestId("invite-status")).toHaveTextContent(/to complete/);
    fireEvent.click(screen.getByRole("button", { name: "Complete invitation" }));
    const dialog = screen.getByRole("dialog", { name: "Invitation setup" });
    expect(within(dialog).getByText("Who should be invited?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("asks about access, prep and a note for an outside LP review, and sends the note", async () => {
    open({
      meetingType: "lp_review",
      attendees: [{ name: "Lee", email: "lee@lp.com", type: "external" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete invitation" }));
    const dialog = screen.getByRole("dialog", { name: "Invitation setup" });

    // Confidential kind of meeting, quick access on by default: asked.
    expect(within(dialog).getByText(/join straight away, or wait/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: /I'll let them in/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(within(dialog).getByText(/read or prepare anything/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Preparation for guests"), { target: { value: "Read the Q3 pack" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    // 60 minutes, outside guest: the agenda question.
    expect(within(dialog).getByText(/What will you cover/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    // The note is drafted from what was just answered.
    fireEvent.click(within(dialog).getByRole("button", { name: "Draft one for me" }));
    expect((within(dialog).getByLabelText("Personal note") as HTMLTextAreaElement).value).toContain("Before we meet: Read the Q3 pack");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(within(dialog).getByText(/1 person will be emailed — 1 outside your team/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Invitation setup" })).toBeNull();
    expect(screen.getByTestId("invite-status")).toHaveTextContent(/Nothing left to ask/);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toBe("/api/meetings/schedule");
    expect(posts[0].body.guestQuickAccess).toBe(false);
    expect(posts[0].body.preparationRequirements).toBe("Read the Q3 pack");
    expect(String(posts[0].body.inviteNote)).toContain("Before we meet: Read the Q3 pack");
  });

  it("lets a note written earlier be edited again from Review", () => {
    open({ attendees: [{ name: "Lee", email: "lee@fund.com", type: "internal" }] });
    fireEvent.click(screen.getByRole("button", { name: "Complete invitation" }));
    let dialog = screen.getByRole("dialog", { name: "Invitation setup" });
    fireEvent.change(within(dialog).getByLabelText("Personal note"), { target: { value: "First draft" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    // Reopen: the note is no longer an open question, but it can still be changed.
    fireEvent.click(screen.getByRole("button", { name: "Review invitation" }));
    dialog = screen.getByRole("dialog", { name: "Invitation setup" });
    expect(within(dialog).getByText("First draft")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit note" }));
    fireEvent.change(within(dialog).getByLabelText("Personal note"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText(/No personal note/)).toBeInTheDocument();
  });

  it("does not offer a note when editing a meeting that is already out", () => {
    open({ meetingId: "m9", attendees: [{ name: "Lee", email: "lee@fund.com", type: "internal" }] }, "edit");
    // Nothing to ask for a small internal edit, and no note question to ask.
    expect(screen.getByTestId("invite-status")).toHaveTextContent(/Nothing left to ask/);
  });
});
