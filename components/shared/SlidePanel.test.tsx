/**
 * The shared panel wrappers, tested where they matter most: these two are used
 * across many surfaces, so a focus trap here is the one that covers the most
 * ground — and a regression here is the one that silently un-fixes the most.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlidePanel } from "./SlidePanel";
import { MobileSheet } from "../mobile/MobileSheet";

function Harness({ kind }: { kind: "slide" | "sheet" }) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <input aria-label="Name" />
      <button onClick={() => setOpen(false)}>Save</button>
    </>
  );
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <a href="/behind">Behind</a>
      {kind === "slide" ? (
        <SlidePanel open={open} onClose={() => setOpen(false)} title="Details">
          {body}
        </SlidePanel>
      ) : (
        <MobileSheet open={open} onClose={() => setOpen(false)} title="Details">
          {body}
        </MobileSheet>
      )}
    </>
  );
}

describe.each([
  ["SlidePanel", "slide"],
  ["MobileSheet", "sheet"],
] as const)("%s", (_name, kind) => {
  it("keeps Tab inside the panel rather than reaching the page behind", async () => {
    const user = userEvent.setup();
    render(<Harness kind={kind} />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    // Cycle further than there are controls; focus must never land on the link
    // behind the panel.
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(screen.getByRole("link", { name: "Behind" })).not.toHaveFocus();
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    }
  });

  it("returns focus to the trigger when the panel closes", async () => {
    const user = userEvent.setup();
    render(<Harness kind={kind} />);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("leaves the page tabbable while closed", async () => {
    const user = userEvent.setup();
    render(<Harness kind={kind} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Behind" })).toHaveFocus();
  });
});
