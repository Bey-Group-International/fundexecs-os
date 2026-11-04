jest.mock("@/components/signing/PdfPages", () => ({
  PdfPages: ({ children }: { children: (p: { page: number; width: number; height: number }) => React.ReactNode }) => (
    <div style={{ position: "relative", width: 600, height: 800 }}>{children({ page: 1, width: 600, height: 800 })}</div>
  ),
}));
// The real pad draws on a canvas, which jsdom cannot.
jest.mock("@/components/signing/SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <div>
      <button type="button" onClick={() => onChange("data:image/png;base64,AAAA")}>
        make signature
      </button>
      <span>Draw Type Upload</span>
    </div>
  ),
}));

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SigningSheet, type SheetBlock } from "./SigningSheet";

const block = (over: Partial<SheetBlock>): SheetBlock => ({
  id: "b",
  type: "name",
  page: 1,
  xPct: 10,
  yPct: 10,
  widthPct: 28,
  heightPct: 6,
  required: true,
  prefill: null,
  locked: false,
  ...over,
});
const blocks = [
  block({ id: "n", type: "name", yPct: 10 }),
  block({ id: "s", type: "signature", yPct: 30 }),
  block({ id: "d", type: "datetime", yPct: 50 }),
];

function mount(onSubmit = jest.fn(async () => null as string | null), b = blocks) {
  render(<SigningSheet pdfSrc="/p" blocks={b} done={[]} signerName="Jane Smith" submitLabel="Sign and send back" onSubmit={onSubmit} />);
  return onSubmit;
}

describe("SigningSheet: a × at each spot, one at a time", () => {
  it("opens the first spot with just what it needs, and shows a plain × (no label) elsewhere", () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    // The other two spots are markers, not labelled boxes.
    expect(screen.getAllByText("×").length).toBeGreaterThanOrEqual(3);
  });

  it("walks through the spots with Next and Back, and Next waits for a required entry", () => {
    mount();
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Jane Smith" } });
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByRole("dialog", { name: "Signature" })).toBeTruthy(); // signature: draw, type or upload
    expect(screen.getByText("Draw Type Upload")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Name" })).toBeTruthy();
  });

  it("makes a signature once and offers it again at the next signature spot", () => {
    mount(undefined, [block({ id: "s1", type: "signature", yPct: 10 }), block({ id: "s2", type: "signature", yPct: 40 })]);
    fireEvent.click(screen.getByRole("button", { name: "make signature" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Second signature spot: the one just made is offered, no new pad.
    expect(within(screen.getByRole("dialog", { name: "Signature" })).getByAltText("Your signature")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "make signature" })).toBeNull();
    expect(screen.getByRole("button", { name: /Use it/ })).toBeTruthy();
  });

  it("gives a date and time block date and clock wheels, set to now", () => {
    mount(undefined, [block({ id: "d", type: "datetime" })]);
    expect(screen.getByRole("listbox", { name: "Month" })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Minute" })).toBeTruthy();
    const now = new Date();
    const hour = now.getHours() % 12 === 0 ? 12 : now.getHours() % 12;
    expect(within(screen.getByRole("listbox", { name: "Hour" })).getByRole("option", { name: String(hour) }).getAttribute("aria-selected")).toBe("true");
  });

  it("sends the chosen values, the signature and the date and time once everything is done", async () => {
    const onSubmit = mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Jane Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "make signature" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The last spot (date and time) carries the agreement; Done waits for it.
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Date and time" })).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sign and send back" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [sig, responses] = onSubmit.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(sig).toBe("data:image/png;base64,AAAA");
    expect(responses.n).toBe("Jane Smith");
    expect(responses.d).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("does not ask for a locked, pre-filled block", () => {
    mount(undefined, [block({ id: "c", type: "company", prefill: "Acme LP", locked: true, yPct: 5 }), block({ id: "n", type: "name", yPct: 20 })]);
    expect(screen.getByRole("dialog", { name: "Name" })).toBeTruthy();
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(screen.getByText("Acme LP")).toBeTruthy();
  });

  it("skips a spot that arrives already filled in correctly, still shows it, and a click opens it to change", () => {
    mount(undefined, [
      block({ id: "e", type: "email", prefill: "jane@acme.com", yPct: 5 }),
      block({ id: "n", type: "name", yPct: 20 }),
    ]);
    // Only the name is asked for; the email is on the page.
    expect(screen.getByRole("dialog", { name: "Name" })).toBeTruthy();
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(screen.getByText("jane@acme.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Email: filled/ }));
    const d = screen.getByRole("dialog", { name: "Email" });
    expect(within(d).queryByText(/ of /)).toBeNull();
    expect(within(d).queryByRole("checkbox")).toBeNull();
    expect(within(d).getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("asks again for a prefilled value that is not valid", () => {
    mount(undefined, [block({ id: "e", type: "email", prefill: "not-an-email", yPct: 5 }), block({ id: "n", type: "name", yPct: 20 })]);
    expect(screen.getByRole("dialog", { name: "Email" })).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("keeps the agreement in the bottom bar when the last spot is not open", () => {
    mount();
    // First spot open: the agreement is in the bottom bar, not in the panel.
    expect(within(screen.getByRole("dialog", { name: "Name" })).queryByRole("checkbox")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    // Last spot open: the agreement moves into the panel, and the bar does not repeat it.
    fireEvent.click(screen.getByRole("button", { name: /Date and time: filled/ }));
    expect(within(screen.getByRole("dialog", { name: "Date and time" })).getByRole("checkbox")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });
});
