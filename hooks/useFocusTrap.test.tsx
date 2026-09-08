/**
 * The keyboard half of a modal overlay.
 *
 * A `fixed inset-0` panel is only visually modal: the page behind keeps every
 * link and button in the tab order. Nobody using a mouse ever sees this fail,
 * which is exactly why it needs tests — the bug is silent for the people most
 * likely to catch it.
 */
import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useBodyScrollLock, useFocusTrap } from "./useFocusTrap";

function Overlay({ open, extra }: { open: boolean; extra?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Calendar" tabIndex={-1}>
      <button>Settings</button>
      {extra ? <button>Middle</button> : null}
      <button>Close</button>
    </div>
  );
}

function Page({ extra }: { extra?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open calendar</button>
      <a href="/behind">Behind the overlay</a>
      <Overlay open={open} extra={extra} />
    </>
  );
}

describe("useFocusTrap", () => {
  it("moves focus into the overlay when it opens", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open calendar" }));
    // The dialog itself, not its first control: a screen reader should announce
    // what opened before it announces a button inside it.
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  // The actual bug this hook exists for.
  it("keeps Tab inside the overlay instead of reaching the page behind", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open calendar" }));

    await user.tab();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    // Past the last control it wraps to the first — it does NOT step out onto
    // the link behind the overlay.
    await user.tab();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Behind the overlay" })).not.toHaveFocus();
  });

  it("wraps backwards from the first control to the last", async () => {
    const user = userEvent.setup();
    render(<Page extra />);
    await user.click(screen.getByRole("button", { name: "Open calendar" }));

    await user.tab();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("returns focus to whatever opened the overlay when it closes", async () => {
    const user = userEvent.setup();
    function Closable() {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, open);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open calendar</button>
          {open ? (
            <div ref={ref} role="dialog" tabIndex={-1}>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
          ) : null}
        </>
      );
    }
    render(<Closable />);
    const trigger = screen.getByRole("button", { name: "Open calendar" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close" }));
    // Not the top of the document — back where the member was.
    expect(trigger).toHaveFocus();
  });

  it("does nothing while inactive, so the page tabs normally", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Open calendar" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Behind the overlay" })).toHaveFocus();
  });
});

describe("useBodyScrollLock", () => {
  function Locked({ active }: { active: boolean }) {
    useBodyScrollLock(active);
    return null;
  }

  it("locks the body while active and restores what was there before", () => {
    document.body.style.overflow = "scroll";
    const { rerender, unmount } = render(<Locked active={false} />);
    expect(document.body.style.overflow).toBe("scroll");

    rerender(<Locked active />);
    expect(document.body.style.overflow).toBe("hidden");

    // Restores the previous value rather than clearing it — another overlay may
    // still be open above this one.
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });
});
