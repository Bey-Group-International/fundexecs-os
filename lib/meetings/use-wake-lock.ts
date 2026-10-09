"use client";

import { useEffect } from "react";
import { holdScreenAwake } from "./wake-lock";

/** Keep the screen awake while `active` — for the length of a live call. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    return holdScreenAwake({ navigator: window.navigator as never, document });
  }, [active]);
}
