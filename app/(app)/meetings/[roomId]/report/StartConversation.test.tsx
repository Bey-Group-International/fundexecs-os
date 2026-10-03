import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const draftConversation = jest.fn();
const startConversation = jest.fn();
const refresh = jest.fn();

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("./conversation-actions", () => ({
  draftConversation: (...a: unknown[]) => draftConversation(...a),
  startConversation: (...a: unknown[]) => startConversation(...a),
}));

import { StartConversation } from "./StartConversation";

function setup() {
  const user = userEvent.setup();
  render(
    <StartConversation
      meetingId="m1"
      meetingTitle="Series B sync"
      recipient={{ name: "Ana Lopez", email: "ana@acme.com" }}
      actionItems={["Send the model"]}
    />,
  );
  return user;
}

beforeEach(() => jest.clearAllMocks());

it("opens a composer seeded from the report, without calling the model", async () => {
  const user = setup();
  await user.click(screen.getByRole("button", { name: "Start conversation" }));
  expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Series B sync");
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toContain("- Send the model");
  expect(draftConversation).not.toHaveBeenCalled();
});

it("drafts with Earn only when asked", async () => {
  draftConversation.mockResolvedValue({ ok: true, subject: "Next steps", body: "Hi Ana — drafted", live: true, cached: false });
  const user = setup();
  await user.click(screen.getByRole("button", { name: "Start conversation" }));
  await user.click(screen.getByRole("button", { name: /Draft with Earn/ }));
  await waitFor(() => expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Hi Ana — drafted"));
  expect(draftConversation).toHaveBeenCalledWith("m1", "ana@acme.com");
});

it("sends through the inbox and says when it went to approvals", async () => {
  startConversation.mockResolvedValue({ ok: true, threadId: "t1", gated: true, message: "Sent to your approvals." });
  const user = setup();
  await user.click(screen.getByRole("button", { name: "Start conversation" }));
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(/Sent to your approvals\./)).toBeTruthy();
  expect(screen.getByRole("link", { name: /Review in approvals/ }).getAttribute("href")).toBe("/inbox");
  const fd = startConversation.mock.calls[0][0] as FormData;
  expect(fd.get("email")).toBe("ana@acme.com");
  expect(fd.get("meeting_id")).toBe("m1");
  expect(refresh).toHaveBeenCalled();
});

it("keeps the composer open with the reason when sending fails", async () => {
  startConversation.mockResolvedValue({ ok: false, error: "Mailbox not connected" });
  const user = setup();
  await user.click(screen.getByRole("button", { name: "Start conversation" }));
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Mailbox not connected")).toBeTruthy();
  expect(screen.getByLabelText("Message")).toBeTruthy();
});

it("continues this meeting's thread, keeping its subject, and says when a draft was reused", async () => {
  draftConversation.mockResolvedValue({ ok: true, subject: "Other", body: "Reused body", live: true, cached: true });
  startConversation.mockResolvedValue({ ok: true, threadId: "t1", continued: true, subject: "Follow-up: Series B sync", gated: false, message: "Sent." });
  const user = userEvent.setup();
  render(
    <StartConversation
      meetingId="m1"
      meetingTitle="Series B sync"
      recipient={{ name: "Ana Lopez", email: "ana@acme.com" }}
      actionItems={[]}
      continuing={{ subject: "Follow-up: Series B sync" }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Continue conversation" }));
  expect(screen.queryByLabelText("Subject")).toBeNull();
  expect(screen.getByText(/Continuing “Follow-up: Series B sync”/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Draft with Earn/ }));
  expect(await screen.findByText(/Reused the Earn draft/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(/Sent\./);
  const fd = startConversation.mock.calls[0][0] as FormData;
  expect(fd.get("subject")).toBe("Follow-up: Series B sync");
});
