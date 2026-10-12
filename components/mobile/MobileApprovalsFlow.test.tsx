import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const enqueue = jest.fn();
const toast = jest.fn();
const decideInboxApprovals = jest.fn();
const approveEditedInboxMessage = jest.fn();
jest.mock("./offlineQueue", () => ({ enqueue: (...a: unknown[]) => enqueue(...a) }));
jest.mock("./MobileToast", () => ({ useMobileToast: () => ({ toast }) }));
jest.mock("./useOnline", () => ({ useOnline: () => true }));
jest.mock("./haptics", () => ({ haptic: () => {} }));
jest.mock("./MobileSyncRegistrar", () => ({ APPROVAL_DECISION_TYPE: "approval" }));
jest.mock("./MobileSheet", () => ({
  MobileSheet: ({ open, children, title }: { open: boolean; children: React.ReactNode; title: string }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));
jest.mock("@/app/(app)/inbox/actions", () => ({
  decideInboxApprovals: (...a: unknown[]) => decideInboxApprovals(...a),
  approveEditedInboxMessage: (...a: unknown[]) => approveEditedInboxMessage(...a),
}));

import { MobileApprovalsFlow, type ApprovalItem } from "./MobileApprovalsFlow";

function message(over: Record<string, unknown> = {}) {
  return {
    taskId: "t",
    threadId: "th",
    action: "send_reply" as const,
    actionLabel: "Reply",
    body: "Thanks for today.",
    sharePreface: null,
    to: { name: "Ana Diaz", email: "ana@acme.com" },
    subject: "Re: Follow-up: IC",
    from: "host@fund.com",
    threadHref: "/inbox?q=ana%40acme.com",
    meeting: { id: "m1", title: "Series B sync", roomCode: "abc" },
    contact: { company: "Acme", title: "Partner" },
    lastInbound: null,
    editable: true,
    failed: null,
    authorId: "author",
    scheduledAt: null,
    waitingSince: null,
    ...over,
  };
}

function approval(id: string, over: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    approvalId: id,
    title: `Reply — ${id}`,
    description: null,
    preview: null,
    agentLabel: "IR",
    agentColor: null,
    risk: "medium",
    hubLabel: null,
    requestedAt: null,
    message: message(),
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

it("shows the email a held inbox message will send", () => {
  render(<MobileApprovalsFlow items={[approval("a1")]} />);
  expect(screen.getByText("Ana Diaz <ana@acme.com>")).toBeTruthy();
  expect(screen.getByText("Re: Follow-up: IC")).toBeTruthy();
  expect(screen.getByText("Thanks for today.")).toBeTruthy();
  expect(screen.getByText("Partner · Acme")).toBeTruthy();
});

it("will not let an author approve their own message", async () => {
  const user = userEvent.setup();
  render(<MobileApprovalsFlow items={[approval("a1", { selfAuthored: true })]} />);
  expect(screen.getByText(/someone else has to approve it/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Approve/ }));
  expect(enqueue).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/someone else/) }));
});

it("approves a meeting's remaining messages at once", async () => {
  decideInboxApprovals.mockResolvedValue({
    results: [
      { approvalId: "a1", ok: true },
      { approvalId: "a2", ok: true },
    ],
  });
  const user = userEvent.setup();
  render(<MobileApprovalsFlow items={[approval("a1"), approval("a2"), approval("b1", { message: message({ meeting: null }) })]} />);
  await user.click(screen.getByRole("button", { name: /Approve all 2 · Series B sync/ }));
  expect(decideInboxApprovals).toHaveBeenCalledWith(["a1", "a2"], "approved");
  // The batch is cleared; the next card is the unrelated message.
  expect(await screen.findByText("1 to decide")).toBeTruthy();
});

it("edits and approves the edit", async () => {
  approveEditedInboxMessage.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  render(<MobileApprovalsFlow items={[approval("a1", { message: message({ meeting: null }) })]} />);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const box = screen.getByRole("textbox", { name: "Edit the message" });
  await user.clear(box);
  await user.type(box, "Shorter.");
  await user.click(screen.getByRole("button", { name: /Approve & send edit/ }));
  expect(approveEditedInboxMessage).toHaveBeenCalledWith("a1", "Shorter.");
  expect(await screen.findByText("Cleared.")).toBeTruthy();
});
