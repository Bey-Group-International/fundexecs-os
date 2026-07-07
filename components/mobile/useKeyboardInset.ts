"use client";

import { useEffect, useState } from "react";

// Reports how many CSS pixels at the BOTTOM of the layout are currently hidden
// behind the on-screen (soft) keyboard, so a fixed-position element can lift up
// by exactly that amount instead of being buried under the keys.
//
// WHY: the Earn composer is a fixed bottom bar meant for on-the-go typing. On
// mobile, when the soft keyboard opens it slides over the bottom of the screen
// and covers a `position: fixed; bottom: 0` element completely — you can't see
// what you're typing. Callers translate the composer up by the returned value
// (e.g. `transform: translateY(-{inset}px)`) so it rides just above the keys.
//
// HOW: browsers expose two viewports. The *layout* viewport (`window.innerHeight`)
// stays the full screen height; the *visual* viewport (`window.visualViewport`)
// shrinks to the region still visible above the keyboard. The difference between
// them — minus any offset the visual viewport has scrolled — is the number of
// pixels the keyboard is covering at the bottom. We recompute this on every
// visualViewport `resize` and `scroll` event (the keyboard opening/closing and
// on-screen panning both fire these).
//
// GRACEFUL DEGRADATION: this is a purely additive presentational aid. When the
// `visualViewport` API is unavailable (older browsers) or we're rendering on the
// server, the hook returns 0 — callers add `0px` of lift, i.e. no visual change
// versus not having the hook at all. Nothing depends on it being non-zero.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    // Unsupported: leave the inset at 0 (no lift) and skip subscribing.
    if (!vv) return;

    const update = () => {
      const covered = Math.round(
        Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
      );
      // Ignore sub-keyboard jitter (URL bar collapse, chrome rounding). Only a
      // real keyboard covers meaningfully more than a couple dozen pixels.
      setInset(covered < 24 ? 0 : covered);
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
