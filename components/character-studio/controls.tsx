"use client";

/**
 * Small, reusable control atoms for the Character Studio inspector — pill
 * option rows and color-swatch grids styled to the office's gold/graphite
 * institutional palette. Framework-light: plain buttons, keyboard-focusable,
 * with non-color selection cues (ring + check) so they read without relying on
 * color alone.
 */

const GOLD = "#c9a84c";

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400"
      style={{ fontFamily: "Georgia, serif" }}
    >
      {children}
    </h3>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[9px] uppercase tracking-[0.16em] text-slate-500">{children}</span>;
}

/** A horizontal row of mutually-exclusive text pills. */
export function OptionPills<T extends string>({
  label,
  options,
  value,
  onSelect,
  format,
}: {
  label?: string;
  options: readonly T[];
  value: T;
  onSelect: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(o)}
              className="rounded-md border px-2.5 py-1 text-[11px] capitalize transition-colors"
              style={{
                borderColor: active ? `${GOLD}90` : "rgba(255,255,255,0.1)",
                background: active ? `${GOLD}1c` : "rgba(255,255,255,0.02)",
                color: active ? GOLD : "#cbd2dc",
              }}
            >
              {format ? format(o) : o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A grid of selectable color swatches (`#rrggbb` strings). */
export function ColorSwatches({
  label,
  colors,
  selected,
  onSelect,
}: {
  label?: string;
  colors: readonly string[];
  selected: string;
  onSelect: (c: string) => void;
}) {
  const norm = selected.toLowerCase();
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => {
          const active = c.toLowerCase() === norm;
          return (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={active}
              onClick={() => onSelect(c)}
              className="relative h-7 w-7 rounded-full transition-transform"
              style={{
                background: c,
                outline: active ? `2px solid ${GOLD}` : "1px solid rgba(255,255,255,0.14)",
                outlineOffset: active ? 2 : 0,
                transform: active ? "scale(1.06)" : undefined,
              }}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
                  style={{ color: "rgba(0,0,0,0.7)", textShadow: "0 0 2px rgba(255,255,255,0.6)" }}
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
