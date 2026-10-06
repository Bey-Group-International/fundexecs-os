/**
 * The menus that hang off the control bar.
 *
 * The second half of the same fault as the fold: a panel that opens off the edge
 * of the window is a feature nobody can press. There are two ways it happened,
 * and position fixes neither of them.
 *
 * A panel WIDER than the window cannot be rescued by moving it: clamping its left
 * edge to the margin leaves the rest hanging off the right, which is how a long
 * device name ("Logitech BRIO 4K Stream Edition (046d:085e)") put half a camera
 * list off-screen. And `minWidth` does it unprompted — the background picker asks
 * for 330px, which does not fit a 320px phone at all.
 *
 * jsdom has no layout: every rect is zero and `offsetWidth` is 0, which is a
 * panel that always fits. So the panel is given a width and the window a size,
 * and what is asserted is the one property that matters — the whole panel is
 * inside the window.
 */
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { FloatingMenu } from "./room-shared";

/** How wide the panel's content wants to be, before anything clamps it. */
let panelWidth = 0;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() { return panelWidth; },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return 200; } });
});

afterEach(() => {
  for (const prop of ["offsetWidth", "scrollHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 0 });
  }
});

/** A phone, with the anchor at the bottom of it where the control bar is. */
function phone(width = 320, height = 640) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Element.prototype.getBoundingClientRect = function () {
    return { left: width - 60, top: height - 56, right: width - 20, bottom: height - 16, width: 40, height: 40, x: width - 60, y: height - 56, toJSON: () => ({}) } as DOMRect;
  };
}

function Harness({ minWidth, label }: { minWidth: number; label: string }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef}>anchor</button>
      <FloatingMenu open anchorRef={anchorRef} onClose={() => {}} minWidth={minWidth}>
        <span>{label}</span>
      </FloatingMenu>
    </>
  );
}

const px = (v: string | number | undefined) => Number.parseFloat(String(v ?? ""));

describe("a menu on a screen narrower than it wants to be", () => {
  it("keeps the whole panel inside the window", () => {
    phone(320);
    panelWidth = 600; // a camera list with long device names in it
    render(<Harness minWidth={0} label="Logitech BRIO 4K Stream Edition (046d:085e)" />);

    const panel = screen.getByRole("menu");
    const left = px(panel.style.left);
    const maxWidth = px(panel.style.maxWidth);
    // Position alone is not the fix: the panel is 600px wide and the window is
    // 320px, so without a maximum there is no left edge that keeps it on screen.
    expect(maxWidth).toBeLessThanOrEqual(320 - 16);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + maxWidth).toBeLessThanOrEqual(320);
  });

  /**
   * The minimum is a preference; the window is not. In CSS `min-width` outranks
   * `max-width` whenever the two disagree, so declaring both and hoping is not a
   * fix — the minimum itself has to come down.
   */
  it("gives up the minimum width it asked for rather than bleed", () => {
    phone(320);
    panelWidth = 330;
    render(<Harness minWidth={330} label="Background effects" />);

    const panel = screen.getByRole("menu");
    expect(px(panel.style.minWidth)).toBeLessThanOrEqual(320 - 16);
    expect(px(panel.style.minWidth)).toBeLessThanOrEqual(px(panel.style.maxWidth));
  });

  it("still honours the minimum where there is room for it", () => {
    phone(1280);
    panelWidth = 330;
    render(<Harness minWidth={330} label="Background effects" />);

    expect(px(screen.getByRole("menu").style.minWidth)).toBe(330);
  });

  it("opens above the bar it hangs off, not under the edge of the screen", () => {
    phone(320, 640);
    panelWidth = 220;
    render(<Harness minWidth={220} label="More" />);

    const panel = screen.getByRole("menu");
    // Pinned by its BOTTOM edge, just above the anchor whose top is 584: 640 -
    // 584 + 8 = 64 from the bottom of the window.
    expect(px(panel.style.bottom)).toBe(64);
    expect(panel.style.top).toBe("");
  });

  it("is anchored by the edge that touches the bar, so later content grows upward", () => {
    // The whole point, and the thing a `top` could not give. The panel's body
    // arrives after it opens — the background picker's chunk loads dynamically
    // and its saved images come from IndexedDB — so the height measured at open
    // is nearly nothing. Pinned by `top` from that height, everything that
    // arrived afterwards grew DOWNWARD over the bar and off the screen; pinned by
    // `bottom` there is no height to get wrong.
    phone(320, 640);
    panelWidth = 220;
    render(<Harness minWidth={220} label="Background" />);

    const panel = screen.getByRole("menu");
    const pinned = px(panel.style.bottom);
    // Ten times taller, same pin. jsdom runs no ResizeObserver, so this is the
    // attachment itself being asserted rather than a re-measure rescuing it.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return 2000; } });
    window.dispatchEvent(new Event("resize"));
    expect(px(panel.style.bottom)).toBe(pinned);
    expect(panel.style.top).toBe("");
  });

  it("opens downward from a bar at the TOP of the window, pinned by its top", () => {
    // The other direction has to keep working: a menu whose anchor is at the top
    // has no room above it, and pinning its bottom there would put it off-screen.
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
    Element.prototype.getBoundingClientRect = function () {
      return { left: 20, top: 16, right: 60, bottom: 56, width: 40, height: 40, x: 20, y: 16, toJSON: () => ({}) } as DOMRect;
    };
    panelWidth = 220;
    render(<Harness minWidth={220} label="More" />);

    const panel = screen.getByRole("menu");
    expect(px(panel.style.top)).toBe(64);
    expect(panel.style.bottom).toBe("");
  });
});
