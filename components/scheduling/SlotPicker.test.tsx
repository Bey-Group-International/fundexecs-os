/**
 * The day rail, whose two labels used to be built with an Intl.DateTimeFormat
 * constructed inline in the render body — twice per day shown, on every render.
 *
 * They moved into lib/meetings/scheduling.ts to be cached with the rest, which
 * is a change to how the picker draws itself, so this covers what it draws.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { SlotPicker } from "./SlotPicker";

// 2026-10-05 is a Monday. 14:00Z is 10:00 in New York, so the New York cases
// stay on the same calendar day and only the clock moves.
const MON = "2026-10-05T14:00:00.000Z";
const TUE = "2026-10-06T14:00:00.000Z";

function slot(start: string) {
  return { start, end: new Date(new Date(start).getTime() + 1_800_000).toISOString() };
}

it("labels each day with its weekday, date and how many times are open", () => {
  render(
    <SlotPicker
      slots={[slot(MON), slot("2026-10-05T15:00:00.000Z"), slot(TUE)]}
      timezone="UTC"
      selected={null}
      onSelect={() => {}}
    />,
  );

  const days = screen.getAllByRole("tab");
  expect(days).toHaveLength(2);
  expect(days[0].textContent).toBe("MonOct 52 open");
  expect(days[1].textContent).toBe("TueOct 61 open");
});

it("labels the same instant by the viewer's own zone", () => {
  // 22:30Z on the 5th is already the 6th in Singapore.
  render(
    <SlotPicker slots={[slot("2026-10-05T22:30:00.000Z")]} timezone="Asia/Singapore" selected={null} onSelect={() => {}} />,
  );
  expect(screen.getAllByRole("tab")[0].textContent).toBe("TueOct 61 open");
  expect(screen.getByRole("button", { name: "6:30 AM" })).toBeTruthy();
});

it("shows the times of whichever day is picked", () => {
  render(
    <SlotPicker
      slots={[slot(MON), slot(TUE), slot("2026-10-06T16:00:00.000Z")]}
      timezone="UTC"
      selected={null}
      onSelect={() => {}}
    />,
  );

  expect(screen.getByRole("button", { name: "2:00 PM" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "4:00 PM" })).toBeNull();

  fireEvent.click(screen.getAllByRole("tab")[1]);
  expect(screen.getByRole("button", { name: "4:00 PM" })).toBeTruthy();
});

it("reports the slot that was pressed, not the label", () => {
  const picked: string[] = [];
  render(<SlotPicker slots={[slot(MON)]} timezone="UTC" selected={null} onSelect={(s) => picked.push(s)} />);
  fireEvent.click(screen.getByRole("button", { name: "2:00 PM" }));
  expect(picked).toEqual([MON]);
});

it("says nothing is open rather than drawing an empty rail", () => {
  render(<SlotPicker slots={[]} timezone="UTC" selected={null} onSelect={() => {}} emptyMessage="Nothing free." />);
  expect(screen.getByText("Nothing free.")).toBeTruthy();
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
});

// An unknown zone used to throw inside the render body, because the rail's two
// inline formatters had no fallback. Now the labels degrade instead.
it("still draws when the zone is one this runtime has never heard of", () => {
  render(<SlotPicker slots={[slot(MON)]} timezone="Mars/Olympus_Mons" selected={null} onSelect={() => {}} />);
  expect(screen.getAllByRole("tab")[0].textContent).toContain("Mon");
});

describe("finding a time faster", () => {
  it("offers the way back to the first open time once another day is open", () => {
    const picked: string[] = [];
    render(
      <SlotPicker
        slots={[slot(TUE), slot(MON)]}
        timezone="UTC"
        selected={null}
        onSelect={(s) => picked.push(s)}
      />,
    );
    // On the first day the first time is already the first button.
    expect(screen.queryByRole("button", { name: /first open time/i })).toBeNull();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    fireEvent.click(screen.getByRole("button", { name: /first open time/i }));
    expect(picked).toEqual([MON]);
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("splits a long day into morning, afternoon and evening by the viewer's clock", () => {
    const hours = [9, 10, 11, 13, 14, 18];
    render(
      <SlotPicker
        slots={hours.map((h) => slot(`2026-10-05T${String(h).padStart(2, "0")}:00:00.000Z`))}
        timezone="UTC"
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Morning")).toBeTruthy();
    expect(screen.getByText("Afternoon")).toBeTruthy();
    expect(screen.getByText("Evening")).toBeTruthy();
  });

  it("leaves a short day as one list", () => {
    render(<SlotPicker slots={[slot(MON), slot("2026-10-05T19:00:00.000Z")]} timezone="UTC" selected={null} onSelect={() => {}} />);
    expect(screen.queryByText("Morning")).toBeNull();
    expect(screen.queryByText("Evening")).toBeNull();
  });

  it("moves along the days with the arrow keys", () => {
    render(<SlotPicker slots={[slot(MON), slot(TUE)]} timezone="UTC" selected={null} onSelect={() => {}} />);
    const [mon, tue] = screen.getAllByRole("tab");
    expect(mon.getAttribute("aria-selected")).toBe("true");
    expect(tue.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(mon, { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "Home" });
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
  });
});
