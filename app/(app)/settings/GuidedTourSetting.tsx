"use client";

import { useEffect, useState } from "react";

// Settings control for the floating guided tour. The tour lives in the app
// layout and keeps its own state in localStorage; here we just read that state
// and drive it through the same window events the account menu uses, so the
// overlay reacts live without a reload.

const HIDDEN_KEY = "fx_tour_hidden_v1";

export function GuidedTourSetting() {
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setMounted(true);
    function read() {
      try {
        setHidden(localStorage.getItem(HIDDEN_KEY) === "1");
      } catch {
        // ignore malformed storage
      }
    }
    read();
    // Reflect changes made from the overlay itself (its Hide button).
    window.addEventListener("fx:tour-visibility-changed", read);
    return () => window.removeEventListener("fx:tour-visibility-changed", read);
  }, []);

  function show() {
    setHidden(false);
    window.dispatchEvent(new Event("fx:open-tour"));
  }

  function hide() {
    setHidden(true);
    window.dispatchEvent(new Event("fx:hide-tour"));
  }

  return (
    <div className="fx-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">Guided tour</p>
          <p className="mt-1 text-xs leading-snug text-fg-secondary">
            The step-by-step walkthrough that floats in the bottom-right corner. Hide it once
            you know your way around, or bring it back here any time.
          </p>
        </div>
        {mounted ? (
          <button
            type="button"
            onClick={hidden ? show : hide}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              hidden
                ? "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
                : "border-line text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
            }`}
          >
            {hidden ? "Show tour" : "Hide tour"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
