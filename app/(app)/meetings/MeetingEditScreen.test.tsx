/**
 * The scheduler checks a picked time against connected calendars as it is
 * picked, and will not schedule over time one of them has taken.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeetingEditScreen } from "./MeetingEditScreen";

let busy: Array<{ start: string; end: string }> = [];
const calls: string[] = [];

beforeEach(() => {
  busy = [];
  calls.length = 0;
  global.fetch = (async (url: string) => {
    calls.push(String(url));
    if (String(url).startsWith("/api/meetings/busy")) return { ok: true, json: async () => ({ busy }) };
    return { ok: false, json: async () => null };
  }) as unknown as typeof fetch;
});

function open() {
  render(
    <MeetingEditScreen
      mode="create"
      initial={{ scheduledAt: new Date(2026, 9, 5, 10, 0).toISOString() }}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
}

it("refuses to schedule over busy time, and offers no Save anyway", async () => {
  busy = [{ start: new Date(2026, 9, 5, 10, 0).toISOString(), end: new Date(2026, 9, 5, 10, 30).toISOString() }];
  open();

  expect(await screen.findByText(/busy on your connected calendar/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Schedule" })).toBeDisabled();
  expect(screen.queryByLabelText(/save anyway/i)).toBeNull();
  // A draft can still be kept while another time is found.
  expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
});

it("asks from the time on screen to half a day past it", async () => {
  open();
  await waitFor(() => expect(calls.some((u) => u.startsWith("/api/meetings/busy"))).toBe(true));
  const url = new URL(calls.find((u) => u.startsWith("/api/meetings/busy"))!, "http://x");
  expect(url.searchParams.get("start")).toBe(new Date(2026, 9, 5, 10, 0).toISOString());
  expect(url.searchParams.get("end")).toBe(new Date(2026, 9, 5, 22, 0).toISOString());
});

it("offers the next free time, and moves the meeting there keeping its length", async () => {
  // Busy 10:00–11:15, so a one-hour meeting next fits at 11:30.
  busy = [{ start: new Date(2026, 9, 5, 10, 0).toISOString(), end: new Date(2026, 9, 5, 11, 15).toISOString() }];
  open();

  const offer = await screen.findByRole("button", { name: /use next free time/i });
  expect(offer.textContent).toMatch(/11:30/);

  busy = [];
  fireEvent.click(offer);
  expect(screen.getByDisplayValue("11:30")).toBeInTheDocument();
  expect(screen.getByDisplayValue("12:30")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Schedule" })).toBeEnabled());
});

it("does not count busy time later in the day as a clash", async () => {
  busy = [{ start: new Date(2026, 9, 5, 15, 0).toISOString(), end: new Date(2026, 9, 5, 16, 0).toISOString() }];
  open();
  await waitFor(() => expect(calls.some((u) => u.startsWith("/api/meetings/busy"))).toBe(true));
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("button", { name: "Schedule" })).toBeEnabled();
  expect(screen.queryByText(/busy on your connected calendar/i)).toBeNull();
});

it("leaves a free time alone", async () => {
  open();
  await waitFor(() => expect(calls.some((u) => u.startsWith("/api/meetings/busy"))).toBe(true));
  expect(screen.getByRole("button", { name: "Schedule" })).toBeEnabled();
  expect(screen.queryByText(/busy on your connected calendar/i)).toBeNull();
});
