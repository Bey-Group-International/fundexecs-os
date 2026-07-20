// In-office chat logic for the Virtual Office — the message model plus the two
// pure, DOM-free rules the UI leans on: input sanitization and scope-based
// visibility. Kept side-effect free so the geometry (proximity) and text
// handling are unit-testable without a DOM or a live Supabase channel.
import { PROXIMITY_RADIUS } from "./layout";
import { distance } from "./presence";

/**
 * A single chat message broadcast across the office channel. Proximity-scoped
 * messages carry the sender's origin (`x`/`y` in tile space) so every receiver
 * can decide locally whether they're close enough to see it.
 */
export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  /** Author's avatar accent color (hex), for rendering the name. */
  color: string;
  text: string;
  /** "office" reaches everyone; "proximity" only those near the origin. */
  scope: "office" | "proximity";
  /** Sender's tile-space position when the message was sent. */
  x: number;
  y: number;
  /** Epoch milliseconds the message was sent. */
  ts: number;
}

/**
 * Normalize raw chat input for broadcast: strip control characters, collapse
 * runs of whitespace into single spaces, trim the ends, and cap the length.
 * Returns "" for empty/whitespace-only input so callers can skip sending.
 */
export function sanitizeChatText(raw: string, max: number = 500): string {
  return raw
    // Strip non-whitespace C0/C1 control chars outright (keep \t\n\r so the
    // whitespace collapse below can turn line breaks into single spaces).
    .replace(/[\x00-\x08\x0e-\x1f\x7f-\x9f]/g, "")
    // Collapse any whitespace run to a single space.
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, max));
}

/**
 * Whether `msg` should be visible to a viewer at `viewer`. Office-scoped
 * messages are always visible; proximity-scoped ones only when the viewer is
 * within `radius` tiles of the message origin.
 */
export function isMessageVisible(
  msg: ChatMessage,
  viewer: { x: number; y: number },
  radius: number = PROXIMITY_RADIUS,
): boolean {
  if (msg.scope === "office") return true;
  return distance({ x: msg.x, y: msg.y }, viewer) <= radius;
}
