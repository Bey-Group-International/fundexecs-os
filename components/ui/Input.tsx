import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the control. */
  label?: string;
  /** Muted helper text rendered below the control. */
  hint?: string;
  /** Lucide icon component rendered inside the field on the left. */
  icon?: LucideIcon;
}

const FIELD_CLASSES =
  'w-full rounded-xl border border-hairline bg-surface-2 text-sm text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]';

/**
 * Input — a labelled text input with an optional leading Lucide icon, focus
 * ring, and hint text. Forwards the ref to the underlying input.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, icon: Icon, className, id, ...props },
  ref
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={fieldId} className="text-[12.5px] font-medium text-fg-3">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4">
            <Icon size={16} strokeWidth={1.9} aria-hidden />
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          className={cn(FIELD_CLASSES, Icon ? 'py-2.5 pl-[38px] pr-3' : 'px-3 py-2.5', className)}
          {...props}
        />
      </div>
      {hint && <span className="text-[11.5px] text-fg-5">{hint}</span>}
    </div>
  );
});
