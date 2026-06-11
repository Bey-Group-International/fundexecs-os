'use client';

import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: LucideIcon;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  hint?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}

/** Labeled input with an optional leading icon — the prototype's `Field`. */
export function Field({
  label,
  value,
  onChange,
  icon: Icon,
  type = 'text',
  placeholder,
  hint,
  required,
  autoComplete,
  className
}: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[12.5px] font-medium text-fg-3">
        {label}
      </label>
      <div className="relative mt-1.5">
        {Icon && (
          <Icon
            size={15}
            strokeWidth={1.9}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5"
            aria-hidden
          />
        )}
        <input
          id={id}
          type={type}
          required={required}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-xl border border-hairline bg-surface-2 py-2.5 pr-3 text-[13.5px] text-fg-1 placeholder:text-fg-5 focus:border-[var(--accent)] focus:outline-none',
            Icon ? 'pl-9' : 'pl-3'
          )}
        />
      </div>
      {hint && <p className="mt-1.5 text-[11.5px] text-fg-5">{hint}</p>}
    </div>
  );
}
