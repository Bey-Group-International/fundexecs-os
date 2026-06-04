/**
 * Ambient type for the Chain-of-Trust toast bridge. The global `emitTrust`
 * is defined by the trust toast layer (shipped on another branch); calling it
 * must be a no-op when absent, so it is declared optional and tolerant.
 */
export interface TrustToast {
  /** Which Chain-of-Trust layer the completion advances. */
  layer: 'Truth' | 'Concept' | 'Execution' | 'Work' | (string & {});
  title: string;
  msg: string;
  /** Rolled-up completion percentage, when known. */
  pct?: number;
  /** The entity (deal, objective, task) the proof attaches to. */
  entity?: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    emitTrust?: (toast: TrustToast) => void;
  }
}

export {};
