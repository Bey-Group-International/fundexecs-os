import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FollowUpPanel } from "./FollowUpPanel";

const DRAFT = "Hi {{first_name}},\n\nGood meeting.\n\nBest,\nHana";
const RECIPIENTS = [
  { name: "Ana Ruiz", email: "ana@fund.com", role: "attendee" as const, attended: true, receivesFollowUp: true },
  { name: "Tom Lee", email: "tom@pension.org", role: "invitee" as const, attended: null, receivesFollowUp: true },
];

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];
let statusLines: unknown[] = [];

beforeEach(() => {
  calls = [];
  statusLines = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).endsWith("/follow-up/status")) {
      return { ok: true, json: async () => ({ lines: statusLines, bookingUrl: "https://x/book/hana", hostEmail: "hana@fund.com" }) } as Response;
    }
    if (String(url).endsWith("/follow-up/rewrite")) return { ok: true, json: async () => ({ body: "Dear {{first_name}},\n\nThank you." }) } as Response;
    return { ok: true, json: async () => ({ sent: 2, total: 2, unreachable: [], failed: [] }) } as Response;
  });
});

function setup(extra: Partial<React.ComponentProps<typeof FollowUpPanel>> = {}) {
  return render(
    <FollowUpPanel
      meetingId="m1"
      draft={DRAFT}
      canSend
      recipients={RECIPIENTS}
      actionItems={["Ana: send the model by Friday", "Tom Lee: confirm the allocation"]}
      trackDelivery
      undoSeconds={0}
      {...extra}
    />,
  );
}

const sends = () => calls.filter((c) => c.url === "/api/meetings/m1/follow-up");

it("reviews who gets what before sending, flagging people outside the firm", async () => {
  setup();
  await waitFor(() => expect(calls.some((c) => c.url.endsWith("/status"))).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: /send now to 2/i }));
  const review = screen.getByRole("region", { name: "Review before sending" });
  expect(within(review).getAllByText("External")).toHaveLength(1);
  expect(within(review).getByText(/Tom Lee is outside your firm/)).toBeInTheDocument();
  expect(within(review).getAllByText(/1 next step of their own/)).toHaveLength(2);
  expect(sends()).toHaveLength(0);
  fireEvent.click(within(review).getByRole("button", { name: "Confirm and send" }));
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0].body).toMatchObject({ personalItems: true, nudgeAfterDays: null, sendAt: null });
});

it("can be taken back during the undo window", async () => {
  jest.useFakeTimers();
  setup({ undoSeconds: 5 });
  fireEvent.click(screen.getByRole("button", { name: /send now to 2/i }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
  expect(screen.getByRole("status")).toHaveTextContent("Sending in 5s");
  act(() => {
    jest.advanceTimersByTime(2000);
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  act(() => {
    jest.advanceTimersByTime(10_000);
  });
  expect(sends()).toHaveLength(0);
  jest.useRealTimers();
});

it("sends when the undo window runs out", async () => {
  jest.useFakeTimers();
  setup({ undoSeconds: 2 });
  fireEvent.click(screen.getByRole("button", { name: /send now to 2/i }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
  // One tick at a time: each second is scheduled after the last one renders.
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
  jest.useRealTimers();
  await waitFor(() => expect(sends()).toHaveLength(1));
});

it("schedules for later with a nudge", async () => {
  setup();
  fireEvent.change(screen.getByLabelText("When to send"), { target: { value: "later" } });
  fireEvent.change(screen.getByLabelText("Nudge if no reply"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Schedule…" }));
  fireEvent.click(screen.getByRole("button", { name: "Schedule it" }));
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(typeof sends()[0].body!.sendAt).toBe("string");
  expect(sends()[0].body!.nudgeAfterDays).toBe(3);
});

it("previews a reader's own next steps", () => {
  setup();
  expect(screen.getByText("send the model by Friday")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: /preview as/i }), { target: { value: "1" } });
  expect(screen.getByText("confirm the allocation")).toBeInTheDocument();
});

it("shows delivery per person and retries the failed ones", async () => {
  statusLines = [
    { id: "1", email: "ana@fund.com", name: "Ana Ruiz", state: "replied", at: "2026-11-06T10:00:00Z", error: null, nudgeAfterDays: null },
    { id: "2", email: "tom@pension.org", name: "Tom Lee", state: "failed", at: null, error: "bounced", nudgeAfterDays: null },
  ];
  setup();
  const list = await screen.findByRole("region", { name: "Delivery" });
  expect(within(list).getByText("Replied")).toBeInTheDocument();
  expect(within(list).getByText(/bounced/)).toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: "Retry 1 failed" }));
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0].body).toMatchObject({ only: ["tom@pension.org"] });
});

it("rewrites in a tone and can undo the change", async () => {
  setup();
  fireEvent.change(screen.getByLabelText("Tone"), { target: { value: "formal" } });
  fireEvent.click(screen.getByRole("button", { name: "Rewrite" }));
  await screen.findByText(/Rewritten/);
  const call = calls.find((c) => c.url.endsWith("/rewrite"))!;
  expect(call.body).toMatchObject({ tone: "formal" });
  expect(screen.getByText("Thank you.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo change" }));
  expect(screen.getByText("Good meeting.")).toBeInTheDocument();
});

it("adds the host's booking link before the sign-off", async () => {
  setup();
  const add = await screen.findByRole("button", { name: "Add booking link" });
  fireEvent.click(add);
  expect(screen.getByText(/pick a time for our next conversation here: https:\/\/x\/book\/hana/)).toBeInTheDocument();
});
