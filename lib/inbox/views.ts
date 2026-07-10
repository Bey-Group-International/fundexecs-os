// lib/inbox/views.ts
// Saved filter views for the communications inbox — LinkedIn-style one-click
// presets (All / Unread / Starred) that sit above the search bar. Pure: each
// view maps to a canonical patch of the read-state / star URL params, and the
// active view is derived back from the current params for chip highlighting.
// The channel, assignee, and free-text filters stay orthogonal — a view never
// touches them — so a saved view composes with a channel or teammate filter.

export type SavedViewKey = "all" | "unread" | "starred";

export interface SavedView {
  key: SavedViewKey;
  label: string;
}

// Presentation order of the quick-view chips.
export const SAVED_VIEWS: SavedView[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "starred", label: "Starred" },
];

/**
 * The URL-param patch a saved view applies. Mutually exclusive over the
 * read-state / star pair: selecting one clears the other, so the three chips
 * behave like a single-choice segmented control. Empty string clears a param.
 */
export function viewParams(key: SavedViewKey): { unread: string; starred: string } {
  switch (key) {
    case "unread":
      return { unread: "1", starred: "" };
    case "starred":
      return { unread: "", starred: "1" };
    case "all":
    default:
      return { unread: "", starred: "" };
  }
}

/**
 * Which saved view the current params represent, for highlighting the active
 * chip. Starred wins over unread when (somehow) both are set, matching the
 * mutually-exclusive patch above.
 */
export function activeView(p: {
  unread?: string | null;
  starred?: string | null;
}): SavedViewKey {
  if (p.starred === "1") return "starred";
  if (p.unread === "1") return "unread";
  return "all";
}
