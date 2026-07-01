/**
 * Design Token Architecture — Feature 11
 *
 * Single source of truth for semantic CSS variable references used in
 * non-Tailwind contexts: Recharts, canvas, inline styles, and test
 * assertions. Tailwind utility classes (bg-surface-1, text-fg-primary,
 * etc.) remain the preferred approach inside JSX; reach for these tokens
 * only where Tailwind cannot be applied.
 *
 * All values are CSS var() references that resolve at runtime from the
 * custom properties defined in app/globals.css, so theme switching
 * (dark → day) is handled automatically.
 */

// ---------------------------------------------------------------------------
// Surface ramp
// ---------------------------------------------------------------------------

export const TOKENS = {
  surface: {
    0: "var(--surface-0)",
    1: "var(--surface-1)",
    2: "var(--surface-2)",
    3: "var(--surface-3)",
  },

  // ---------------------------------------------------------------------------
  // Foreground / text
  // ---------------------------------------------------------------------------

  fg: {
    primary: "var(--fg-primary)",
    secondary: "var(--fg-secondary)",
    muted: "var(--fg-muted)",
  },

  // ---------------------------------------------------------------------------
  // Accent family (labelled "gold" to avoid churn; resolves to blue accent)
  // ---------------------------------------------------------------------------

  gold: {
    300: "var(--gold-300)",
    400: "var(--gold-400)",
    500: "var(--gold-500)",
  },

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  status: {
    success: "var(--status-success)",
    warning: "var(--status-warning)",
    danger: "var(--status-danger)",
    info: "var(--status-info)",
  },

  // ---------------------------------------------------------------------------
  // Border / divider
  // ---------------------------------------------------------------------------

  line: "var(--line)",
} as const;

// ---------------------------------------------------------------------------
// Chart color palette
// ---------------------------------------------------------------------------

/**
 * Six-color sequence for Recharts and other chart libraries.
 * Ordered for perceptual contrast: accent family first, then status colors.
 */
export const chartColors: readonly string[] = [
  TOKENS.gold[400],
  TOKENS.gold[300],
  TOKENS.status.success,
  TOKENS.status.info,
  TOKENS.status.warning,
  TOKENS.status.danger,
] as const;

// ---------------------------------------------------------------------------
// Status → token helper
// ---------------------------------------------------------------------------

/**
 * Maps deal / commitment status strings to a CSS variable token.
 * Returns the `info` token for any unrecognised status so callers always
 * receive a valid color reference.
 */
export function statusColor(status: string): string {
  const normalised = status.toLowerCase().trim();

  switch (normalised) {
    // Success / closed / active states
    case "closed":
    case "closed won":
    case "funded":
    case "active":
    case "complete":
    case "completed":
    case "committed":
      return TOKENS.status.success;

    // Warning / in-progress / pending states
    case "in progress":
    case "in-progress":
    case "pending":
    case "due diligence":
    case "diligence":
    case "negotiating":
    case "term sheet":
    case "soft circle":
      return TOKENS.status.warning;

    // Danger / lost / cancelled states
    case "lost":
    case "closed lost":
    case "cancelled":
    case "canceled":
    case "withdrawn":
    case "passed":
    case "rejected":
      return TOKENS.status.danger;

    // Info / pipeline / prospecting states
    case "prospect":
    case "prospecting":
    case "pipeline":
    case "outreach":
    case "intro":
    case "new":
    case "open":
    default:
      return TOKENS.status.info;
  }
}
