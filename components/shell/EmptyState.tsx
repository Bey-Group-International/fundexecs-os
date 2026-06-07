import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Optional CTA slot — e.g. a Button. */
  action?: React.ReactNode;
}

/**
 * EmptyState — tasteful zero-data placeholder.
 *
 * Centered icon + title + body copy + optional action. Used across module
 * surfaces when the loader returns an empty dataset. Tokens-only styling
 * on a transparent background (sits inside a Card or page container).
 */
export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-1 text-fg-4"
        aria-hidden
      >
        <Icon size={22} strokeWidth={1.6} />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-fg-1">{title}</h3>
      <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-fg-4">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
