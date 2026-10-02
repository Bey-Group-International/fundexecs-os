// lib/wheel-forward.ts
//
// In a full-height app shell (the LP data room viewer) only the reading pane
// scrolls, so a wheel turned over the header or a short sidebar did nothing at
// all. These helpers send such a wheel to the pane instead — but only when
// nothing under the cursor could have used it, so a scrollable sidebar or
// preview still scrolls itself first.

/** Pixels per line for `deltaMode === 1` (Firefox with a mouse wheel). */
const LINE_PX = 16;

/** True when `el` is a vertical scroller with room to move by `dy`. */
export function canScrollBy(el: Element, dy: number): boolean {
  if (dy === 0) return false;
  const style = getComputedStyle(el);
  if (!/(auto|scroll)/.test(style.overflowY)) return false;
  if (el.scrollHeight <= el.clientHeight) return false;
  if (dy < 0) return el.scrollTop > 0;
  // Sub-pixel layouts can leave scrollTop a fraction short of the bottom.
  return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

/** Whether any element from `target` up to (not including) `root` would scroll by `dy`. */
export function hasScrollableBetween(target: Element | null, root: Element, dy: number): boolean {
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (canScrollBy(el, dy)) return true;
  }
  return false;
}

/** A wheel's vertical distance in pixels, whatever unit the device reported. */
export function wheelDeltaPx(e: Pick<WheelEvent, "deltaY" | "deltaMode">, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * pageHeight;
  return e.deltaY;
}

/**
 * Route wheels over `root` that nothing else would use to `pane`. Returns the
 * cleanup. The listener is non-passive because it must cancel the event it
 * forwards — otherwise an outer scroller could move as well.
 */
export function forwardWheel(root: HTMLElement, pane: HTMLElement): () => void {
  const onWheel = (e: WheelEvent) => {
    // Pinch-zoom and horizontal swipes belong to the browser.
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || pane.contains(target)) return;
    const dy = wheelDeltaPx(e, pane.clientHeight);
    if (hasScrollableBetween(target, root, dy) || !canScrollBy(pane, dy)) return;
    e.preventDefault();
    pane.scrollTop += dy;
  };
  root.addEventListener("wheel", onWheel, { passive: false });
  return () => root.removeEventListener("wheel", onWheel);
}
