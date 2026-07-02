"use client";

import { useState, useId } from "react";

export interface ValidationRule {
  validate: (value: string) => boolean;
  /** Context-aware message explaining WHY the field matters and WHAT a correct value looks like. */
  message: string;
}

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rules?: ValidationRule[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  type?: React.HTMLInputTypeAttribute;
  disabled?: boolean;
  className?: string;
}

export function FormField({
  label,
  value,
  onChange,
  rules = [],
  placeholder,
  hint,
  required,
  multiline,
  rows = 3,
  type = "text",
  disabled,
  className,
}: FormFieldProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);

  // Only show errors after the user has blurred the field.
  const error = touched
    ? rules.find((rule) => !rule.validate(value))?.message
    : undefined;

  const borderClass = error
    ? "border-status-danger focus:border-status-danger"
    : value && !error && touched
      ? "border-status-success focus:border-status-success"
      : "border-line focus:border-gold-400";

  const sharedInputClass = `w-full rounded-lg border bg-surface-1 px-3 py-2 text-sm text-fg-primary outline-none transition placeholder:text-fg-muted disabled:opacity-50 ${borderClass}`;

  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <label
        htmlFor={id}
        className="text-xs font-medium uppercase tracking-wider text-fg-secondary"
      >
        {label}
        {required ? (
          <span className="ml-1 text-status-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>

      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={`${sharedInputClass} resize-none`}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={!!error}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          disabled={disabled}
          className={sharedInputClass}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={!!error}
        />
      )}

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-status-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Common rule factories so callers don't repeat boilerplate.
export const rules = {
  required: (fieldName: string): ValidationRule => ({
    validate: (v) => v.trim().length > 0,
    message: `${fieldName} is required so agents can reference this record across sessions.`,
  }),
  maxLength: (max: number, context: string): ValidationRule => ({
    validate: (v) => v.length <= max,
    message: `Limit to ${max} characters — ${context}`,
  }),
  minLength: (min: number, example?: string): ValidationRule => ({
    validate: (v) => v.trim().length >= min,
    message: `Enter at least ${min} characters${example ? ` (e.g. ${example})` : ""}.`,
  }),
  numeric: (example: string): ValidationRule => ({
    validate: (v) => v === "" || /^\d+(\.\d+)?$/.test(v.replace(/[$,\s]/g, "")),
    message: `Enter a number (e.g. ${example}). No dollar signs or commas.`,
  }),
  email: (): ValidationRule => ({
    validate: (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    message: "Enter a valid email address (e.g. name@firm.com).",
  }),
};
