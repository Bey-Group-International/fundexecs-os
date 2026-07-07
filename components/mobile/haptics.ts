// Tiny haptic-feedback helper for the mobile app shell. Uses the Vibration API
// where the device supports it (Android / Chromium); a silent no-op elsewhere
// (notably iOS Safari, which doesn't expose it). Kept dependency-free and safe
// to call from any client event handler.
type Pattern = "tap" | "select" | "success" | "warn";

const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 8,
  select: 12,
  success: [10, 40, 16],
  warn: [22, 30, 22],
};

export function haptic(pattern: Pattern = "tap"): void {
  if (typeof navigator === "undefined") return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  // Respect a reduced-motion preference as a proxy for "minimize physical
  // feedback" — users who quiet motion generally want quieter interfaces.
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    vibrate(PATTERNS[pattern]);
  } catch {
    /* vibrate can throw if called without a user gesture — ignore */
  }
}
