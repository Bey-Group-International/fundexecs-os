"use client";

// A controlled avatar customizer. The parent owns the AvatarConfig and wires
// persistence; this component only renders the pickers and reports changes via
// `onChange`. Swatch pickers for the colors, segmented pickers for the enum
// choices, and a live pixel preview. Styled with the repo's surface/fg/gold
// tokens so it sits inside the office UI without extra theming.
import type { ReactNode } from "react";
import {
  ACCESSORIES,
  HAIR_COLORS,
  HAIR_STYLES,
  SHIRT_COLORS,
  SKIN_TONES,
  type Accessory,
  type AvatarConfig,
  type HairStyle,
} from "@/lib/office/avatarConfig";
import { AvatarPreview } from "@/components/office/AvatarPreview";

interface AvatarCustomizerProps {
  value: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
}

const HAIR_LABELS: Record<HairStyle, string> = {
  short: "Short",
  long: "Long",
  bun: "Bun",
  buzz: "Buzz",
  bald: "Bald",
};

const ACCESSORY_LABELS: Record<Accessory, string> = {
  none: "None",
  glasses: "Glasses",
  headset: "Headset",
  cap: "Cap",
  beanie: "Beanie",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

function SwatchRow({
  colors,
  selected,
  onSelect,
  label,
}: {
  colors: string[];
  selected: string;
  onSelect: (color: string) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {colors.map((color) => {
        const active = color === selected;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={color}
            onClick={() => onSelect(color)}
            className={`h-7 w-7 rounded-full border transition ${
              active
                ? "border-gold-400 ring-2 ring-gold-400/40"
                : "border-border hover:border-fg-muted"
            }`}
            style={{ backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  selected,
  onSelect,
  labels,
  label,
}: {
  options: T[];
  selected: T;
  onSelect: (value: T) => void;
  labels: Record<T, string>;
  label: string;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5 rounded-lg bg-surface-1 p-1"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const active = option === selected;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(option)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-surface-3 text-fg-primary shadow-sm"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}

export function AvatarCustomizer({ value, onChange }: AvatarCustomizerProps) {
  const patch = (next: Partial<AvatarConfig>) => onChange({ ...value, ...next });

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-center gap-2 rounded-xl bg-surface-2 p-4">
        <AvatarPreview config={value} size={64} facing="down" />
        <span className="text-xs text-fg-muted">Preview</span>
      </div>

      <div className="flex flex-1 flex-col gap-4">
        <Field label="Skin">
          <SwatchRow
            label="Skin tone"
            colors={SKIN_TONES}
            selected={value.skin}
            onSelect={(skin) => patch({ skin })}
          />
        </Field>

        <Field label="Hair style">
          <Segmented
            label="Hair style"
            options={HAIR_STYLES}
            selected={value.hair}
            onSelect={(hair) => patch({ hair })}
            labels={HAIR_LABELS}
          />
        </Field>

        <Field label="Hair color">
          <SwatchRow
            label="Hair color"
            colors={HAIR_COLORS}
            selected={value.hairColor}
            onSelect={(hairColor) => patch({ hairColor })}
          />
        </Field>

        <Field label="Shirt">
          <SwatchRow
            label="Shirt color"
            colors={SHIRT_COLORS}
            selected={value.shirt}
            onSelect={(shirt) => patch({ shirt })}
          />
        </Field>

        <Field label="Accessory">
          <Segmented
            label="Accessory"
            options={ACCESSORIES}
            selected={value.accessory}
            onSelect={(accessory) => patch({ accessory })}
            labels={ACCESSORY_LABELS}
          />
        </Field>
      </div>
    </div>
  );
}

export default AvatarCustomizer;
