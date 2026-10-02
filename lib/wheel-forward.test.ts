/** @jest-environment jsdom */
import { canScrollBy, forwardWheel, hasScrollableBetween, wheelDeltaPx } from "./wheel-forward";

// jsdom does no layout, so give elements the box metrics a browser would.
function box(el: HTMLElement, { scrollHeight, clientHeight, scrollTop = 0, overflowY = "auto" }: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop?: number;
  overflowY?: string;
}) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  el.scrollTop = scrollTop;
  el.style.overflowY = overflowY;
  return el;
}

function wheel(target: Element, deltaY: number, init: WheelEventInit = {}) {
  const e = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe("canScrollBy", () => {
  it("needs a scrolling overflow and room in the wheel's direction", () => {
    const el = box(document.createElement("div"), { scrollHeight: 500, clientHeight: 100, scrollTop: 0 });
    expect(canScrollBy(el, 40)).toBe(true);
    expect(canScrollBy(el, -40)).toBe(false);
    el.scrollTop = 400;
    expect(canScrollBy(el, 40)).toBe(false);
    expect(canScrollBy(el, -40)).toBe(true);
  });

  it("ignores boxes that do not overflow or are not scrollers", () => {
    expect(canScrollBy(box(document.createElement("div"), { scrollHeight: 100, clientHeight: 100 }), 40)).toBe(false);
    expect(
      canScrollBy(box(document.createElement("div"), { scrollHeight: 500, clientHeight: 100, overflowY: "hidden" }), 40),
    ).toBe(false);
  });
});

describe("wheelDeltaPx", () => {
  it("converts lines and pages to pixels", () => {
    expect(wheelDeltaPx({ deltaY: 30, deltaMode: 0 }, 800)).toBe(30);
    expect(wheelDeltaPx({ deltaY: 3, deltaMode: 1 }, 800)).toBe(48);
    expect(wheelDeltaPx({ deltaY: 1, deltaMode: 2 }, 800)).toBe(800);
  });
});

describe("forwardWheel", () => {
  let root: HTMLElement;
  let header: HTMLElement;
  let rail: HTMLElement;
  let pane: HTMLElement;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    header = document.createElement("header");
    rail = box(document.createElement("aside"), { scrollHeight: 100, clientHeight: 100 });
    pane = box(document.createElement("main"), { scrollHeight: 2000, clientHeight: 600 });
    root.append(header, rail, pane);
    document.body.append(root);
    stop = forwardWheel(root, pane);
  });
  afterEach(() => stop());

  it("scrolls the pane for a wheel over the header", () => {
    const e = wheel(header, 120);
    expect(e.defaultPrevented).toBe(true);
    expect(pane.scrollTop).toBe(120);
  });

  it("scrolls the pane for a wheel over a rail with nothing to scroll", () => {
    wheel(rail, 80);
    expect(pane.scrollTop).toBe(80);
  });

  it("lets a rail that can scroll take the wheel itself", () => {
    box(rail, { scrollHeight: 900, clientHeight: 100 });
    const e = wheel(rail, 80);
    expect(e.defaultPrevented).toBe(false);
    expect(pane.scrollTop).toBe(0);
  });

  it("leaves wheels inside the pane, zoom gestures and sideways swipes alone", () => {
    expect(wheel(pane, 80).defaultPrevented).toBe(false);
    expect(wheel(header, 80, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(header, 10, { deltaX: 80 }).defaultPrevented).toBe(false);
    expect(pane.scrollTop).toBe(0);
  });

  it("does nothing once the pane is at its end", () => {
    pane.scrollTop = 1400;
    expect(wheel(header, 80).defaultPrevented).toBe(false);
    expect(pane.scrollTop).toBe(1400);
  });

  it("stops forwarding after cleanup", () => {
    stop();
    wheel(header, 80);
    expect(pane.scrollTop).toBe(0);
  });

  it("checks every scroller between the cursor and the shell", () => {
    const inner = document.createElement("span");
    rail.append(inner);
    expect(hasScrollableBetween(inner, root, 40)).toBe(false);
    box(rail, { scrollHeight: 900, clientHeight: 100 });
    expect(hasScrollableBetween(inner, root, 40)).toBe(true);
  });
});
