import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const startConversation = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("./conversation-actions", () => ({
  startConversation: (...a: unknown[]) => startConversation(...a),
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

it("sends one conversation per person, each greeted by name, and reports failures by name", async () => {
  startConversation
    .mockResolvedValueOnce({ ok: true, threadId: "t1", gated: true, continued: false, subject: "IC", message: "" })
    .mockResolvedValueOnce({ ok: false, error: "Mailbox not connected" });
  const user = userEvent.setup();
  render(<MessageEveryoneNew meetingId="m1" meetingTitle="IC" people={PEOPLE} actionItems={[]} />);
  await user.click(screen.getByRole("button", { name: /Message everyone new \(2\)/ }));
  await user.click(screen.getByRole("button", { name: "Send to 2" }));

  expect(await screen.findByText(/1 of 2 waiting in approvals/)).toBeTruthy();
  expect(screen.getByText(/Not sent to Bo Chen \(Mailbox not connected\)/)).toBeTruthy();
  const bodies = startConversation.mock.calls.map((c) => String((c[0] as FormData).get("body")));
  expect(bodies[0].startsWith("Hi Ana,")).toBe(true);
  expect(bodies[1].startsWith("Hi Bo,")).toBe(true);
  expect(startConversation.mock.calls.map((c) => (c[0] as FormData).get("email"))).toEqual(["ana@acme.com", "bo@x.io"]);
  expect(refresh).toHaveBeenCalled();
});
