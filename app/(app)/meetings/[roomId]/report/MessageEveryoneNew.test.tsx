import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const startConversations = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("./conversation-actions", () => ({
  startConversations: (...a: unknown[]) => startConversations(...a),
}));

import { MessageEveryoneNew } from "./MessageEveryoneNew";

const PEOPLE = [
  { name: "Ana Lopez", email: "ana@acme.com" },
  { name: "Bo Chen", email: "bo@x.io" },
];

beforeEach(() => jest.clearAllMocks());

it("is not offered for a single person", () => {
  const { container } = render(
    <MessageEveryoneNew meetingId="m1" meetingTitle="IC" people={[PEOPLE[0]]} actionItems={[]} />,
  );
  expect(container.textContent).toBe("");
});

it("sends everyone in one batched call and reports failures by name", async () => {
  startConversations.mockResolvedValueOnce({
    ok: true,
    results: [
      { email: "ana@acme.com", name: "Ana Lopez", ok: true, gated: true },
      { email: "bo@x.io", name: "", ok: false, error: "Mailbox not connected" },
    ],
  });
  const user = userEvent.setup();
  render(<MessageEveryoneNew meetingId="m1" meetingTitle="IC" people={PEOPLE} actionItems={[]} />);
  await user.click(screen.getByRole("button", { name: /Message everyone new \(2\)/ }));
  await user.click(screen.getByRole("button", { name: "Send to 2" }));

  expect(await screen.findByText(/1 of 2 waiting in approvals/)).toBeTruthy();
  // The name the server left blank comes from the attendee list.
  expect(screen.getByText(/Not sent to Bo Chen \(Mailbox not connected\)/)).toBeTruthy();
  expect(startConversations).toHaveBeenCalledTimes(1);
  const arg = startConversations.mock.calls[0][0] as { meetingId: string; body: string; emails: string[] };
  expect(arg.meetingId).toBe("m1");
  expect(arg.emails).toEqual(["ana@acme.com", "bo@x.io"]);
  // Personalised on the server, so the token travels as written.
  expect(arg.body).toContain("{first_name}");
  expect(refresh).toHaveBeenCalled();
});

it("shows a whole-batch refusal in the composer", async () => {
  startConversations.mockResolvedValueOnce({ ok: false, error: "Too many group messages at once — try again in a minute." });
  const user = userEvent.setup();
  render(<MessageEveryoneNew meetingId="m1" meetingTitle="IC" people={PEOPLE} actionItems={[]} />);
  await user.click(screen.getByRole("button", { name: /Message everyone new \(2\)/ }));
  await user.click(screen.getByRole("button", { name: "Send to 2" }));
  expect(await screen.findByText(/Too many group messages/)).toBeTruthy();
  expect(refresh).not.toHaveBeenCalled();
});
