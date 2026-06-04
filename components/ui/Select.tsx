import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Field label rendered above the control. */
  label?: string;
  /** Muted helper text rendered below the control. */
  hint?: string;
  /** Options — strings (value === label) or `{ value, label }` objects. */
  options: Array<string | SelectOption>;
  placeholder?: string;
}

function normalize(o: string | SelectOption): SelectOption {
  return typeof o === 'string' ? { value: o, label: o } : o;
}

const FIELD_CLASSES =
  'w-full appearance-none cursor-pointer rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 pr-9 text-sm text-fg-1 outline-none transition focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]';

/**
 * Select — the `Field` dropdown pattern: optional label, focus ring, hint, and
 * a trailing chevron. Native `<select>` styled to match the dark canvas.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, options, placeholder, className, id, ...props },
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
        <select ref={ref} id={fieldId} className={cn(FIELD_CLASSES, className)} {...props}>
          {placeholder && (
            <option value="" disabled className="bg-[#0e1526]">
              {placeholder}
            </option>
          )}
          {options.map((o) => {
            const opt = normalize(o);
            return (
              <option key={opt.value} value={opt.value} className="bg-[#0e1526]">
                {opt.label}
              </option>
            );
          })}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-4">
          <ChevronDown size={15} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      {hint && <span className="text-[11.5px] text-fg-5">{hint}</span>}
    </div>
  );
});
