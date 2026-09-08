"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keep keyboard focus inside an open overlay.
 *
 * A `fixed inset-0` panel hides the page visually but not from the keyboard:
 * without this, Tab walks straight out of the overlay and into the links and
 * buttons behind it, which are still in the tab order and still clickable. A
 * sighted mouse user never notices; anyone driving by keyboard or screen reader
 * ends up operating a page they cannot see.
 *
 * Three things, which belong together because each is useless alone:
 *
 *   - Tab and Shift+Tab wrap at the ends of the overlay rather than escaping.
 *   - Focus moves into the overlay on open, so the first Tab lands inside it
 *     instead of resuming from wherever the trigger left off.
 *   - Focus returns to whatever opened the overlay on close, so closing does
 *     not dump the member back at the top of the document.
 *
 * Escape is deliberately NOT handled here. Overlays differ on what Escape
 * means — this app's calendar backs out of its settings pane before closing —
 * and burying that decision in a shared hook would take it away from them.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: { restoreFocus?: boolean } = {},
) {
  const { restoreFocus = true } = options;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Captured before focus moves, so it survives whatever the overlay does.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the overlay itself rather than its first control: landing on the
    // close button reads to a screen reader as "Close" with no idea what was
    // opened, where the container carries the dialog's own label.
    if (!container.contains(document.activeElement)) {
      container.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableWithin(container);
      const current = document.activeElement as HTMLElement | null;
      const outside = !current || current === container || !container.contains(current);

      if (items.length === 0) {
        // Nothing to land on, but the page behind still must not receive focus.
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      // Focus sitting on the container itself is the normal state right after
      // opening. Tab from there must enter the overlay, not fall through to
      // whatever the browser considers next in the document.
      if (e.shiftKey) {
        if (outside || current === first) {
          e.preventDefault();
          last.focus();
        }
        return;
      }

      if (outside || current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore only when nothing else has claimed focus. Closing an overlay
      // detaches it, and the browser drops focus to <body> — that, or focus
      // still inside the overlay, means this hook is the one that owes the
      // member a destination. If something else took focus on the way out (a
      // second overlay opening on top, a close that navigated), leaving it
      // alone is the whole point.
      const active = document.activeElement as HTMLElement | null;
      const ours = !active || active === document.body || container.contains(active);
      if (restoreFocus && ours && previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [containerRef, active, restoreFocus]);
}

/**
 * The controls inside `container` that Tab should actually visit, in document
 * order. Queried on every keystroke rather than cached: an overlay like the
 * calendar changes shape constantly — panes swap, popovers open, a month
 * redraws with a different number of events — and a list captured at mount
 * would be stale by the first Tab.
 */
function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") return false;
    // `checkVisibility` is what skips a control in a pane that is mounted but
    // not on screen — the calendar keeps both its panes mounted to preserve
    // their state, so the settings form is in the DOM while the grid is what
    // the member is looking at.
    //
    // Where the method does not exist there is no layout engine to ask (jsdom,
    // older browsers), so nothing is filtered. Trapping a few controls that
    // happen to be hidden is a much smaller failure than concluding the overlay
    // has none and swallowing Tab entirely.
    const checkVisibility = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
    return typeof checkVisibility === "function" ? checkVisibility.call(el) : true;
  });
}

/**
 * Everything the browser will put in the tab order, minus what an author has
 * deliberately removed with `tabindex="-1"`.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[tabindex]",
]
  .map((s) => `${s}:not([tabindex="-1"]):not([disabled])`)
  .join(", ");

/**
 * Stop the page behind an overlay from scrolling under it.
 *
 * Separate from the trap because they answer to different things: a
 * full-screen panel wants both, a small popover wants neither, and an inline
 * drawer may want only the scroll lock. Restores whatever the body had rather
 * than assuming `""` — another overlay may still be open above this one.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
