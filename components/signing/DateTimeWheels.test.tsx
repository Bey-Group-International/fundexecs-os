import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DateTimeWheels } from "./DateTimeWheels";

function Harness({ start, seen }: { start: Date; seen: (d: Date) => void }) {
  const [d, setD] = useState(start);
  return (
    <DateTimeWheels
      value={d}
      onChange={(n) => {
        setD(n);
        seen(n);
      }}
    />
  );
}
const pick = (wheel: string, option: string) => fireEvent.click(within(screen.getByRole("listbox", { name: wheel })).getByRole("option", { name: option }));

describe("DateTimeWheels", () => {
  const thisYear = new Date().getFullYear();
  it("offers a date wheel and a clock wheel, each value tappable", () => {
    let latest = new Date(thisYear, 10, 4, 14, 3);
    render(<Harness start={latest} seen={(d) => (latest = d)} />);
    for (const w of ["Month", "Day", "Year", "Hour", "Minute", "AM or PM"]) expect(screen.getByRole("listbox", { name: w })).toBeTruthy();
    pick("Month", "Dec");
    pick("Day", "9");
    pick("Hour", "7");
    pick("Minute", "45");
    pick("AM or PM", "AM");
    expect([latest.getMonth(), latest.getDate(), latest.getHours(), latest.getMinutes()]).toEqual([11, 9, 7, 45]);
  });
  it("keeps the day valid when the month changes, and handles noon and midnight", () => {
    let latest = new Date(thisYear, 0, 31, 12, 0);
    render(<Harness start={latest} seen={(d) => (latest = d)} />);
    pick("Month", "Feb");
    expect(latest.getMonth()).toBe(1);
    expect(latest.getDate()).toBeLessThanOrEqual(29);
    expect(latest.getHours()).toBe(12); // 12 PM stays noon
    pick("AM or PM", "AM");
    expect(latest.getHours()).toBe(0); // 12 AM is midnight
  });
});
