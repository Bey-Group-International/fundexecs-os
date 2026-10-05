/**
 * Action items as the tasks they became: tickable by the host or the person
 * they are for, and put back when the tick does not save.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ActionItemsList } from "./ActionItemsList";
import type { ReportActionItem } from "@/lib/meetings/report-participants";

const ITEMS: ReportActionItem[] = [
  { line: "Sarah: Send the deck", task: "Send the deck", owner: "Sarah", done: false, dueAt: null, taskId: "t1", assignedTo: "u-sarah" },
  { line: "Book a call", task: "Book a call", owner: null, done: true, dueAt: null, taskId: "t2", assignedTo: "host-1" },
  { line: "Untracked", task: "Untracked", owner: null, done: false, dueAt: null, taskId: null, assignedTo: null },
];

function mockFetch(ok = true) {
  const calls: Array<{ url: string; body: unknown }> = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok, json: async () => (ok ? { ok: true } : { error: "Nope." }) } as unknown as Response;
  });
  return calls;
}

afterEach(() => jest.resetAllMocks());

it("shows the owner and how many are done", () => {
  render(<ActionItemsList meetingId="m1" items={ITEMS} viewerId="host-1" isHost />);
  expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
  expect(screen.getByText("Sarah")).toBeInTheDocument();
});

it("ticks the task off for the host", async () => {
  const calls = mockFetch();
  render(<ActionItemsList meetingId="m1" items={ITEMS} viewerId="host-1" isHost />);
  await userEvent.click(screen.getByLabelText("Send the deck"));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toEqual({ url: "/api/meetings/m1/action-items", body: { taskId: "t1", done: true } });
  expect(screen.getByText("2 of 3 done")).toBeInTheDocument();
});

it("puts the tick back when it does not save", async () => {
  mockFetch(false);
  render(<ActionItemsList meetingId="m1" items={ITEMS} viewerId="host-1" isHost />);
  await userEvent.click(screen.getByLabelText("Send the deck"));
  expect(await screen.findByText("Nope.")).toBeInTheDocument();
  expect(screen.getByLabelText("Send the deck")).not.toBeChecked();
});

it("lets a non-host tick only their own item", () => {
  render(<ActionItemsList meetingId="m1" items={ITEMS} viewerId="u-sarah" isHost={false} />);
  expect(screen.getByLabelText("Send the deck")).toBeEnabled();
  expect(screen.getByLabelText("Book a call")).toBeDisabled();
});

it("cannot tick an item that never became a task", () => {
  render(<ActionItemsList meetingId="m1" items={ITEMS} viewerId="host-1" isHost />);
  expect(screen.getByLabelText("Untracked")).toBeDisabled();
});

describe("by person", () => {
  const MANY: ReportActionItem[] = [
    { line: "Sarah: Send the deck", task: "Send the deck", owner: "Sarah", done: true, dueAt: null, taskId: "t1", assignedTo: "u-sarah" },
    { line: "Mark: Book the call", task: "Book the call", owner: "Mark", done: false, dueAt: null, taskId: "t2", assignedTo: "u-mark" },
    { line: "Sarah: Draft the memo", task: "Draft the memo", owner: "Sarah", done: false, dueAt: null, taskId: "t3", assignedTo: "u-sarah" },
  ];

  it("groups what each person took away", async () => {
    render(<ActionItemsList meetingId="m1" items={MANY} viewerId="host-1" isHost />);
    await userEvent.click(screen.getByRole("button", { name: "By person" }));

    expect(screen.getByRole("heading", { name: "Sarah" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mark" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 done")).toBeInTheDocument();
    // The items keep their own checkboxes, by their place in the report.
    expect(screen.getByLabelText("Draft the memo")).not.toBeChecked();
  });

  it("is not offered when only one person owns anything", () => {
    render(<ActionItemsList meetingId="m1" items={[MANY[0], MANY[2]]} viewerId="host-1" isHost />);
    expect(screen.queryByRole("button", { name: "By person" })).toBeNull();
  });
});
