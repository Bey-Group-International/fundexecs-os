'use client';

import type { ReactNode } from 'react';

/**
 * EarnPanelTrigger — a hub panel that *is* an Earn action.
 *
 * Wraps a server-rendered panel card in a button that opens the Earn dock
 * seeded with the panel's prompt — the same `fx:earn-open` event the rail's
 * launchers dispatch, so both surfaces trigger the identical action.
 */
export function EarnPanelTrigger({ prompt, children }: { prompt: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="group block w-full text-left"
      onClick={() => window.dispatchEvent(new CustomEvent('fx:earn-open', { detail: { prompt } }))}
    >
      {children}
    </button>
  );
}
