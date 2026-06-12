import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Eyebrow } from './Eyebrow';

/** Card section header: icon square, eyebrow + title, optional action. */
export function PanelHeader({
  icon: Ico,
  title,
  eyebrow,
  action
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <Ico size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div>
          <Eyebrow className="mb-px">{eyebrow}</Eyebrow>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</div>
        </div>
      </div>
      {action}
    </div>
  );
}
