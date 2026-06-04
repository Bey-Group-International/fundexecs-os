/**
 * Global ambient type for the Chain-of-Trust toast bus.
 *
 * `TrustToaster` installs `window.emitTrust` on mount; any screen can fire an
 * ambient proof toast on a task/approval completion via
 * `window.emitTrust({ layer, title, msg, pct, entity })`.
 */

/** The four Chain-of-Trust proof layers, color-coded per the design system. */
export type TrustLayer = 'truth' | 'concept' | 'execution' | 'work';

/** Payload for a single Chain-of-Trust toast. */
export interface TrustEvent {
  /** Which proof layer advanced — drives the toast color. */
  layer: TrustLayer;
  /** Short title, e.g. the entity or the milestone reached. */
  title: string;
  /** One-line supporting message. */
  msg: string;
  /** Optional rolled-up verification percentage (0–100). */
  pct?: number;
  /** Optional entity name (deal / LP) this proof belongs to. */
  entity?: string;
}

declare global {
  interface Window {
    /** Fire a Chain-of-Trust toast. Installed by `TrustToaster` on mount. */
    emitTrust?: (event: TrustEvent) => void;
  }
}

export {};
