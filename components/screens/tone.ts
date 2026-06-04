import type { BadgeTone } from '@/components/ui';

/** Maps a design-system tone to its raw CSS color token, for inline use
 * (icon colors, progress-bar fills, status dots) on the screen views. */
export const TONE_HEX: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};
