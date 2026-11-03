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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  // jsdom has no pointer capture.
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
  return waitFor(() => expect(screen.getByRole("button", { name: /Jane Smith/ })).toBeTruthy());
}

// jsdom has no layout: give the page layer a box so click positions can be turned into percentages.
function clickPage(x: number, y: number) {
  const layer = screen.getByTestId("page").firstElementChild as HTMLElement;
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.pointerDown(layer, { clientX: x, clientY: y });
}

describe("BlockPlacer: one-click placement", () => {
  it("drops a signature block for the recipient with a single click on the page", async () => {
    await mount();
    clickPage(300, 400);
    expect(screen.getAllByRole("button", { name: "Signature block" })).toHaveLength(1);
  });

  it("keeps the chosen block type for the next click, and the switch decides whose block it is", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Email" }));
    clickPage(100, 100);
    fireEvent.click(screen.getByRole("button", { name: /Me/ }));
    clickPage(300, 300);
    fireEvent.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].blocks.map((b) => [b.recipientId, b.type, b.prefill])).toEqual([
      ["r1", "email", "jane@lp.com"],
      ["r2", "email", "owner@fund.com"],
    ]);
  });

  it("shows who still needs a signature block, and will not send until everyone has one", async () => {
    await mount();
    expect(screen.getAllByLabelText("needs a signature block")).toHaveLength(2);
    clickPage(300, 400);
    expect(screen.getAllByLabelText("has a signature block")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Send for signature/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/signature block for yourself/));
  });

  it("offers Email and Phone blocks, and Delete removes the selected block", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Phone" })).toBeTruthy();
    clickPage(300, 400);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Signature block" }), { clientX: 300, clientY: 400, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: "Signature block" })).toBeNull();
  });
});
