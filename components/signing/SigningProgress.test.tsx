import React from "react";
import { render, screen } from "@testing-library/react";
import { SigningProgress } from "./SigningProgress";

describe("SigningProgress", () => {
  it("marks the step in progress and ticks the finished ones", () => {
    render(<SigningProgress current={2} readerName="Jane Smith" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[0].textContent).toContain("✓");
    expect(items[1].textContent).toContain("Jane Smith");
    expect(items[2].getAttribute("aria-current")).toBeNull();
  });
  it("ticks all three once it is complete, with none current", () => {
    render(<SigningProgress current={4} />);
    expect(screen.getAllByRole("listitem").every((i) => i.textContent?.includes("✓") && !i.getAttribute("aria-current"))).toBe(true);
  });
  it("tells the reader which step is theirs and calls the maker the sender", () => {
    render(<SigningProgress current={2} viewer="reader" />);
    const items = screen.getAllByRole("listitem").map((i) => i.textContent ?? "");
    expect(items[0]).toContain("Sender");
    expect(items[1]).toContain("You");
    expect(items[2]).toContain("Sender");
  });
});
