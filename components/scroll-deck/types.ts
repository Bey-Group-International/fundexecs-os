// Shared contract for the Scroll-Deck builder. Centralizing these types lets
// the chat-wiring layer (lib/scroll-deck.ts, useBuilderChat) and the deck layer
// (useDeckStore, BuilderCanvas) depend on one source of truth without importing
// from each other.

export type DeckSectionId =
  | "cover"
  | "thesis"
  | "team"
  | "terms"
  | "track-record"
  | "pipeline"
  | string;

export interface DeckField {
  label: string;
  value: string;
  /** Rendered as a large gold financial figure when true. */
  figure?: boolean;
}

export interface DeckSection {
  id: DeckSectionId;
  title: string;
  /** Short label shown in the canvas outline / progress rail. */
  kicker: string;
  fields: DeckField[];
}

/** A section instance placed on the canvas. `key` is a unique render id — the
 *  same section id can legitimately appear more than once, so React children
 *  are never keyed by the section's own id. */
export interface AppliedSection {
  key: number;
  section: DeckSection;
}

export interface PendingSection {
  key: number;
  section: DeckSection;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** True while an assistant reply is still streaming/typing in. */
  streaming?: boolean;
}

/** The wire shape returned by POST /api/scroll-deck/chat: a prose reply plus
 *  the structured deck section the model (or the deterministic fallback)
 *  produced for this turn. `section` is null when the turn produces no section
 *  (e.g. the deck is already complete). */
export interface ChatProposal {
  reply: string;
  section: DeckSection | null;
}
