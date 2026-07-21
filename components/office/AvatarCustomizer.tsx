"use client";

// A controlled, Woka-style tabbed avatar creator. The parent owns the
// AvatarConfig and wires persistence; this component renders a row of category
// tabs, the selected category's swatch/option grid, and a large live animated
// preview. Cosmetics are role-gated: `optionsFor` drops anything the viewer's
// role can't pick, so leadership-only tones simply don't appear. Styled with the
// repo's surface/fg/gold tokens so it sits inside the office UI without extra
// theming.
import { useState } from "react";
import {
  CATEGORY_META,
  COSMETIC_LAYERS,
  categoryField,
  optionsFor,
  type Accessory,
  type AvatarConfig,
  type Build,
  type CosmeticCategory,
  type FacialHair,
  type HairStyle,
  type OutfitStyle,
} from "@/lib/office/avatarConfig";
import type { MemberRole } from "@/lib/supabase/database.types";
import { AvatarPreview } from "@/components/office/AvatarPreview";

interface AvatarCustomizerProps {
  value: AvatarConfig;
  onChange: (config: AvatarConfig) => void;
  role?: MemberRole | null;
}

const HAIR_LABELS: Record<HairStyle, string> = {
  short: "Short",
  long: "Long",
  bun: "Bun",
  buzz: "Buzz",
  bald: "Bald",
  ponytail: "Ponytail",
  curly: "Curly",
  mohawk: "Mohawk",
};

const OUTFIT_LABELS: Record<OutfitStyle, string> = {
  tee: "Tee",
  blazer: "Blazer",
  hoodie: "Hoodie",
  turtleneck: "Turtleneck",
  dress_shirt: "Dress shirt",
  vneck: "V-neck",
};

const ACCESSORY_LABELS: Record<Accessory, string> = {
  none: "None",
  glasses: "Glasses",
  sunglasses: "Sunglasses",
  headset: "Headset",
  cap: "Cap",
  beanie: "Beanie",
  earrings: "Earrings",
};

const FACIAL_HAIR_LABELS: Record<FacialHair, string> = {
  none: "None",
  stubble: "Stubble",
  beard: "Beard",
  mustache: "Mustache",
};

const BUILD_LABELS: Record<Build, string> = {
  slim: "Slim",
  regular: "Regular",
  broad: "Broad",
};

// Friendly names for the named color swatches — used as the accessible label on
// each color cell (the swatch itself carries the meaning visually).
const COLOR_NAMES: Record<string, string> = {
  "#2f3541": "Charcoal",
  "#26314b": "Navy",
  "#4a5568": "Slate",
  "#383d45": "Graphite",
  "#b08d57": "Camel",
  "#e8e2d4": "Ivory",
  "#31473b": "Forest",
  "#6b2c39": "Burgundy",
  "#9a7d3f": "Brass",
};

// Per-category value → label map for the "option" categories. Swatch categories
// fall back to a color name / the hex itself.
const OPTION_LABELS: Partial<Record<CosmeticCategory, Record<string, string>>> = {
  hair: HAIR_LABELS,
  outfit: OUTFIT_LABELS,
  facialHair: FACIAL_HAIR_LABELS,
  accessory: ACCESSORY_LABELS,
  build: BUILD_LABELS,
};

function labelFor(cat: CosmeticCategory, value: string): string {
  const map = OPTION_LABELS[cat];
  if (map && value in map) return map[value];
  return COLOR_NAMES[value] ?? value;
}

export function AvatarCustomizer({
  value,
  onChange,
  role,
}: AvatarCustomizerProps) {
  const [active, setActive] = useState<CosmeticCategory>(COSMETIC_LAYERS[0]);

  const meta = CATEGORY_META[active];
  const field = categoryField(active);
  const selected = value[field] as string;
  const options = optionsFor(active, { role });

  const select = (next: string) => {
    // The catalogs are the source of truth, so `next` is always a valid member
    // of the field's enum/hex set — a controlled cast keeps the config typed.
    onChange({ ...value, [field]: next } as AvatarConfig);
  };

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-center gap-2 self-center rounded-xl bg-surface-2 p-4 sm:self-start sm:sticky sm:top-4">
        <AvatarPreview config={value} size={168} facing="down" animate />
        <span className="text-xs text-fg-muted">Live preview</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div
          role="tablist"
          aria-label="Avatar categories"
          className="flex flex-wrap gap-1.5 rounded-lg bg-surface-1 p-1"
        >
          {COSMETIC_LAYERS.map((cat) => {
            const isActive = cat === active;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                id={`avatar-tab-${cat}`}
                aria-selected={isActive}
                aria-controls={`avatar-panel-${cat}`}
                onClick={() => setActive(cat)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-surface-3 text-fg-primary shadow-sm"
                    : "text-fg-secondary hover:text-fg-primary"
                }`}
              >
                {CATEGORY_META[cat].label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`avatar-panel-${active}`}
          aria-labelledby={`avatar-tab-${active}`}
          className="rounded-xl bg-surface-2 p-4"
        >
          {meta.kind === "swatch" ? (
            <div
              className="flex flex-wrap gap-2.5"
              role="radiogroup"
              aria-label={meta.label}
            >
              {options.map((color) => {
                const isSel = color === selected;
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={isSel}
                    aria-label={labelFor(active, color)}
                    title={labelFor(active, color)}
                    onClick={() => select(color)}
                    className={`h-9 w-9 rounded-full border transition ${
                      isSel
                        ? "border-gold-400 ring-2 ring-gold-400/40"
                        : "border-border hover:border-fg-muted"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          ) : (
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label={meta.label}
            >
              {options.map((option) => {
                const isSel = option === selected;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={isSel}
                    onClick={() => select(option)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      isSel
                        ? "border-gold-400 bg-surface-3 text-fg-primary shadow-sm"
                        : "border-border text-fg-secondary hover:border-fg-muted hover:text-fg-primary"
                    }`}
                  >
                    {labelFor(active, option)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AvatarCustomizer;
