jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
// One 600x800 page; the real component renders pdf.js, which jsdom cannot.
jest.mock("@/components/signing/PdfPages", () => ({
  PdfPages: ({ children }: { children: (p: { page: number; width: number; height: number }) => React.ReactNode }) => (
    <div data-testid="page" style={{ position: "relative", width: 600, height: 800 }}>
      {children({ page: 1, width: 600, height: 800 })}
    </div>
  ),
}));

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BlockPlacer } from "./BlockPlacer";

const fields = {
  recipients: [
    { id: "r1", name: "Jane Smith", email: "jane@lp.com", role: "signer" },
    { id: "r2", name: "Fund Owner", email: "owner@fund.com", role: "owner" },
  ],
  fields: [] as unknown[],
};

let puts: { blocks: { recipientId: string; type: string; prefill: string }[] }[] = [];
beforeEach(() => {
  puts = [];
  // jsdom has no pointer events or pointer capture.
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent;
  HTMLElement.prototype.setPointerCapture = jest.fn();
  global.fetch = jest.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => fields };
  }) as unknown as typeof fetch;
});

function mount() {
  render(<BlockPlacer title="NDA" fieldsUrl="/f" pdfUrl="/p" sendUrl="/s" doneHref="/done" />);
  // Let the document's blocks and parties load.
  return act(async () => {
    await Promise.resolve();
  });
}

// jsdom has no layout: give the page layer a box so click positions can be turned into percentages.
function clickPage(x: number, y: number) {
  const layer = screen.getByTestId("page").firstElementChild as HTMLElement;
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.pointerDown(layer, { clientX: x, clientY: y });
}
const choose = (name: string) => fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name }));

describe("BlockPlacer: click, choose, done", () => {
  it("opens a menu where the page was clicked, and picking a type drops the block there and closes it", async () => {
    await mount();
    expect(screen.queryByRole("menu")).toBeNull();
    clickPage(300, 400);
    const menu = screen.getByRole("menu");
    // Beside the click (16px off it), not on top of it.
    expect(menu.style.left).toBe("calc(50% + 16px)");
    expect(menu.style.top).toBe("calc(50% + 16px)");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Name", "Signature", "Date and time", "Company", "Title", "Address", "Email", "Phone"]);
    choose("Signature");
    expect(screen.queryByRole("menu")).toBeNull();
    const block = screen.getByRole("button", { name: "Signature block" });
    // The block starts at the click, centred on it vertically, so its × is exactly where it was made.
    expect(block.style.left).toBe("50%");
    expect(block.style.top).toBe("48%"); // 50% minus half the 4% height
    expect(block.style.width).toBe("28%");
    expect(block.style.height).toBe("4%");
  });

  it("shows the × at the click straight away, before a type is chosen, and keeps it where the block lands", async () => {
    await mount();
    clickPage(150, 200); // 25% across, 25% down
    const marker = document.querySelector("[data-pending-marker]") as HTMLElement;
    expect(marker.style.left).toBe("25%");
    expect(marker.style.top).toBe("25%");
    choose("Name");
    expect(document.querySelector("[data-pending-marker]")).toBeNull();
    const block = screen.getByRole("button", { name: "Name block" });
    expect(block.style.left).toBe("25%");
    expect(parseFloat(block.style.top) + parseFloat(block.style.height) / 2).toBeCloseTo(25);
  });

  it("closes without placing on Escape, and on a click outside the page", async () => {
    await mount();
    clickPage(300, 400);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    clickPage(300, 400);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: /block$/ })).toBeNull();
  });

  it("opens near the click: flipped back inside the page near the right and bottom edges", async () => {
    await mount();
    clickPage(570, 780);
    expect(screen.getByRole("menu").style.transform).toBe("translate(-100%, -100%)");
    expect(screen.getByRole("menu").style.left).toContain("- 16px");
  });

  it("lets the menu say whose block it is, and pre-fills email with the person's own", async () => {
    await mount();
    clickPage(100, 100);
    choose("Email");
    clickPage(300, 300);
    fireEvent.click(within(screen.getByRole("menu")).getByRole("button", { name: /Me/ }));
    choose("Email");
    fireEvent.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].blocks.map((b) => [b.recipientId, b.type, b.prefill])).toEqual([
      ["r1", "email", "jane@lp.com"],
      ["r2", "email", "owner@fund.com"],
    ]);
  });

  it("shows who still needs a signature block, and will not send until everyone has one", async () => {
    await mount();
    clickPage(300, 400);
    expect(screen.getAllByLabelText("needs a signature block")).toHaveLength(2);
    choose("Signature");
    clickPage(300, 500);
    expect(screen.getAllByLabelText("has a signature block")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Send for signature/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/signature block for yourself/));
  });

  it("Delete removes the selected block", async () => {
    await mount();
    clickPage(300, 400);
    choose("Signature");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Signature block" }), { clientX: 300, clientY: 400, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: "Signature block" })).toBeNull();
  });
});
