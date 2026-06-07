import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type AvatarTone = 'neutral' | 'gold' | 'azure' | 'success' | 'warning' | 'danger' | 'info';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Full name; up to the first two initials are derived and shown. */
  name: string;
  /** Optional photo URL (Google sign-in photo or an uploaded avatar). When
   *  present it renders the image; on load error it silently falls back to
   *  initials. */
  src?: string | null;
  /** Square size in pixels. Radius and font scale from this. Defaults to 32. */
  size?: number;
  tone?: AvatarTone;
}

const TONE_CLASSES: Record<AvatarTone, string> = {
  neutral: 'text-fg-3 bg-surface-2 border-hairline',
  gold: 'text-gold-1 bg-[var(--gold-soft)] border-[var(--gold-line)]',
  azure: 'text-azure-1 bg-[var(--azure-soft)] border-[var(--azure-line)]',
  success: 'text-success bg-[var(--success-soft)] border-[var(--success-line)]',
  warning: 'text-warning bg-[var(--warning-soft)] border-[var(--warning-line)]',
  danger: 'text-danger bg-[var(--danger-soft)] border-[var(--danger-line)]',
  info: 'text-info bg-[var(--info-soft)] border-[var(--info-line)]'
};

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Avatar — a person's photo when one is available (Google sign-in or an
 * uploaded image), otherwise their initials in a tinted, rounded-square chip.
 * Tone-tinted to match the badge palette; size drives the radius and font size.
 *
 * The image uses a plain `<img>` (not `next/image`) so arbitrary remote hosts —
 * `lh3.googleusercontent.com`, Supabase storage — work without per-host
 * `next.config` allowlisting, and `referrerPolicy="no-referrer"` keeps Google
 * photos from 403-ing on referrer checks.
 */
export function Avatar({
  name,
  src,
  size = 32,
  tone = 'azure',
  className,
  style,
  ...props
}: AvatarProps) {
  const radius = size * 0.32;
  return (
    <span
      className={cn(
        'relative inline-flex flex-none items-center justify-center overflow-hidden border font-semibold',
        TONE_CLASSES[tone],
        className
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * 0.38,
        ...style
      }}
      {...props}
    >
      <span aria-hidden>{initialsOf(name)}</span>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ borderRadius: radius }}
          onError={(e) => {
            // Hide the broken image so the initials underneath show through.
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
    </span>
  );
}
