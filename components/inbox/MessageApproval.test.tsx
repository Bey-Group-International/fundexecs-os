import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const decideInboxApproval = jest.fn();
const approveEditedInboxMessage = jest.fn();
const decideInboxApprovals = jest.fn();
const retryInboxMessage = jest.fn();
const discardFailedInboxMessage = jest.fn();
jest.mock("@/app/(app)/inbox/actions", () => ({
  decideInboxApproval: (...a: unknown[]) => decideInboxApproval(...a),
  approveEditedInboxMessage: (...a: unknown[]) => approveEditedInboxMessage(...a),
  decideInboxApprovals: (...a: unknown[]) => decideInboxApprovals(...a),
  retryInboxMessage: (...a: unknown[]) => retryInboxMessage(...a),
  discardFailedInboxMessage: (...a: unknown[]) => discardFailedInboxMessage(...a),
}));

import { MeetingApprovalGroup, MessageApprovalCard, groupByMeeting } from "./MessageApproval";
import type { InboxItem } from "@/lib/inbox";

function item(id: string, over: Partial<NonNullable<InboxItem["message"]>> = {}, withApproval = true): InboxItem {
  return {
    id: `approval:${id}`,
    kind: "approval",
    tone: "approval",
    title: "Reply — Ana",
    subtitle: "",
    href: "/inbox",
    ...(withApproval
      ? {
          approval: {
            approvalId: `appr-${id}`,
            taskId: id,
            agentLabel: null,
            agentColor: null,
            hubLabel: null,
            risk: "medium",
            requestedAt: null,
            detail: null,
            preview: null,
          },
        }
      : {}),
    message: {
      taskId: id,
      threadId: "t1",
      action: "send_reply",
      actionLabel: "Reply",
      body: "Thanks for today.",
      sharePreface: null,
      to: { name: "Ana Diaz", email: "ana@acme.com" },
      subject: "Re: Follow-up: IC",
      from: "host@fund.com",
      threadHref: "/inbox?q=ana%40acme.com",
      meeting: { id: "m1", title: "Series B sync", roomCode: "abc-def" },
      contact: { company: "Acme", title: "Partner" },
      lastInbound: { body: "Send the deck?", at: new Date().toISOString() },
      editable: true,
      failed: null,
      ...over,
    },
  };
}

const onDecided = jest.fn();
const onCleared = jest.fn();
beforeEach(() => jest.clearAllMocks());

it("shows exactly what goes out, from where, and the conversation", () => {
  render(<MessageApprovalCard item={item("1")} onDecided={onDecided} onCleared={onCleared} />);
  expect(screen.getByText("Ana Diaz <ana@acme.com>")).toBeTruthy();
  expect(screen.getByText("Re: Follow-up: IC")).toBeTruthy();
  expect(screen.getByText("host@fund.com")).toBeTruthy();
  expect(screen.getByText("Thanks for today.")).toBeTruthy();
  expect(screen.getByText("Partner · Acme")).toBeTruthy();
  expect(screen.getByText(/Send the deck\?/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /Open conversation/ }).getAttribute("href")).toBe("/inbox?q=ana%40acme.com");
});

it("approves only after a deliberate confirm", async () => {
  decideInboxApproval.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  render(<MessageApprovalCard item={item("1")} onDecided={onDecided} onCleared={onCleared} />);
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(decideInboxApproval).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Yes, approve & send/ }));
  expect(decideInboxApproval).toHaveBeenCalledWith("appr-1", "approved", undefined);
  expect(onDecided).toHaveBeenCalledWith("approval:1", "approved");
});

it("edits and approves the edit", async () => {
  approveEditedInboxMessage.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  render(<MessageApprovalCard item={item("1")} onDecided={onDecided} onCleared={onCleared} />);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getByRole("textbox", { name: "Edit the message" });
  await user.clear(box);
  await user.type(box, "Shorter thanks.");
  await user.click(screen.getByRole("button", { name: /Approve & send edit/ }));
  expect(approveEditedInboxMessage).toHaveBeenCalledWith("appr-1", "Shorter thanks.");
  expect(onDecided).toHaveBeenCalledWith("approval:1", "approved");
});

it("sends it back to Earn with a note", async () => {
  decideInboxApproval.mockResolvedValue({ ok: true, notice: "Earn revised it — it is back in approvals." });
  const user = userEvent.setup();
  render(<MessageApprovalCard item={item("1")} onDecided={onDecided} onCleared={onCleared} />);
  await user.click(screen.getByRole("button", { name: "Send back to Earn" }));
  const submit = screen.getByRole("button", { name: "Send back to Earn" });
  expect(submit.hasAttribute("disabled")).toBe(true);
  await user.type(screen.getByRole("textbox", { name: "What should change?" }), "Propose Thursday");
  await user.click(submit);
  expect(decideInboxApproval).toHaveBeenCalledWith("appr-1", "regenerate", "Propose Thursday");
  expect(onDecided).toHaveBeenCalledWith("approval:1", "regenerate");
});

it("offers no edit or send-back on an action that has no text", () => {
  render(
    <MessageApprovalCard
      item={item("1", { action: "propose_meeting", actionLabel: "Propose a time", body: null, editable: false })}
      onDecided={onDecided}
      onCleared={onCleared}
    />,
  );
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Send back to Earn" })).toBeNull();
  expect(screen.getByText(/Propose a time — carried out on approval/)).toBeTruthy();
});

it("retries a failed message, and keeps it when it fails again", async () => {
  retryInboxMessage.mockResolvedValueOnce({ ok: false, error: "Still not sent: revoked" }).mockResolvedValueOnce({ ok: true });
  const user = userEvent.setup();
  render(
    <MessageApprovalCard item={item("1", { failed: { error: "Mailbox revoked" } }, false)} onDecided={onDecided} onCleared={onCleared} />,
  );
  expect(screen.getByText("Mailbox revoked")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Still not sent: revoked")).toBeTruthy();
  expect(onCleared).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(onCleared).toHaveBeenCalledWith("approval:1");
});

describe("meeting batches", () => {
  it("groups a meeting's messages and leaves everything else alone", () => {
    const other = { ...item("3", { meeting: null }) };
    const groups = groupByMeeting([item("1"), other, item("2"), item("4", { failed: { error: "x" } }, false)]);
    expect(groups).toHaveLength(3);
    expect("meeting" in groups[0] && groups[0].items.map((i) => i.id)).toEqual(["approval:1", "approval:2"]);
    expect(groups[1]).toBe(other);
  });

  it("approves all, clears what went, and names what did not", async () => {
    decideInboxApprovals.mockResolvedValue({
      results: [
        { approvalId: "appr-1", ok: true },
        { approvalId: "appr-2", ok: false, error: "Approved, but it was not sent: revoked" },
      ],
    });
    const user = userEvent.setup();
    const items = [item("1"), item("2", { to: { name: "Bo Chen", email: "bo@x.io" } })];
    render(<MeetingApprovalGroup meeting={items[0].message!.meeting!} items={items} onDecided={onDecided} onCleared={onCleared} />);
    expect(screen.getByText("To Ana Diaz, Bo Chen")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Approve all" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(decideInboxApprovals).toHaveBeenCalledWith(["appr-1", "appr-2"], "approved");
    expect(onDecided).toHaveBeenCalledTimes(1);
    expect(onDecided).toHaveBeenCalledWith("approval:1", "approved");
    expect(await screen.findByText(/Bo Chen: Approved, but it was not sent: revoked/)).toBeTruthy();
  });
});
