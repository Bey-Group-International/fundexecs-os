/**
 * Shared marketing-CTA styles for the public landing surface.
 *
 * These call-to-action treatments were previously copy-pasted as long class
 * strings in Hero, Sections, and LandingNav, so their spacing and styling could
 * silently drift apart. Centralizing them here keeps every landing CTA visually
 * identical. (The app's in-product buttons use the `Button` primitive; these are
 * the larger, anchor-based marketing CTAs.)
 */

/** Large primary CTA — the blue gradient hero/section button ("Claim your desk"). */
export const PRIMARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_12px_30px_-10px_rgba(37,99,235,0.7)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Large secondary CTA — the bordered, glassy companion to PRIMARY_CTA. */
export const SECONDARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-1 px-6 py-3.5 text-[15px] font-medium text-fg-2 backdrop-blur-sm transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1';

/** Compact primary CTA — the smaller variant used in the sticky nav. */
export const NAV_CTA =
  'inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
