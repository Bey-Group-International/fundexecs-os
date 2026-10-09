// A <video> that is in the document but not on the screen.
//
// The recording composer and the background processor each decode a stream
// through a <video> element nobody is meant to see, so they used to keep it
// off the DOM entirely. iOS WebKit does not reliably decode a detached media
// element: it has been seen handing back black frames, or pausing the element
// outright, the moment it is not part of a document. One pixel, transparent
// and inert, costs nothing and is what every browser agrees to keep decoding.
//
// Both are no-ops where there is no document or the element is not a real
// node (the pipeline's tests hand in plain objects), so neither can throw
// inside a live call.

export function attachHiddenVideo(el: HTMLVideoElement): void {
  try {
    if (typeof document === "undefined" || typeof HTMLElement === "undefined") return;
    if (!(el instanceof HTMLElement) || el.isConnected) return;
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(el);
  } catch {
    /* no document to attach to — decoding off-DOM is still better than nothing */
  }
}

export function detachHiddenVideo(el: HTMLVideoElement): void {
  try {
    el.parentNode?.removeChild(el);
  } catch {
    /* already gone */
  }
}
