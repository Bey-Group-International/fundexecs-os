"use client";

import {
  AVATAR_ACCENTS,
  AVATAR_PRESETS,
  BUILDS,
  FACIAL_HAIR_OPTIONS,
  GLASSES_OPTIONS,
  HAIR_COLORS,
  HAIR_STYLES,
  ROLE_LABELS,
  SKIN_TONES,
  WARDROBES,
  applyAvatarPreset,
  effectiveHair,
  effectiveSkin,
  presentationDefaults,
  userAvatarSpec,
  type UserAvatar,
} from "@/lib/office/userAvatar";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";

const BUILD_LABELS: Record<string, string> = { slim: "Slim", regular: "Regular", broad: "Broad" };
const HAIR_STYLE_LABELS: Record<string, string> = {
  short: "Short",
  textured: "Textured",
  tied: "Tied",
  bald: "Bald",
};
const GLASSES_LABELS: Record<string, string> = { none: "None", glasses: "Glasses" };
const FACIAL_HAIR_LABELS: Record<string, string> = {
  none: "None",
  stubble: "Stubble",
  mustache: "Mustache",
  beard: "Beard",
};

/** Format a 0xRRGGBB int as a CSS `#rrggbb` string for swatch fills. */
function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const GOLD = "#c9a84c";
const PANEL_BG = "#0a0806";
const BORDER = "rgba(201, 168, 76, 0.35)";
const BORDER_DIM = "rgba(201, 168, 76, 0.2)";
const SERIF = "Georgia, 'Times New Roman', serif";

const GENDER_OPTIONS: { id: UserAvatar["genderStyle"]; label: string }[] = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "neutral", label: "Neutral" },
];

/** Uppercase, letter-spaced section heading in the office's gold serif. */
function SectionLabel({ children }: { children: string }) {
  return (
    <p
      className="mb-1.5 text-[11px] uppercase tracking-[0.2em]"
      style={{ color: GOLD, fontFamily: SERIF }}
    >
      {children}
    </p>
  );
}

/** A labelled segmented control — one selectable option per value. */
function Segmented<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label={label} style={{ borderColor: BORDER_DIM }}>
        {options.map((opt) => {
          const isSel = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={isSel}
              onClick={() => onSelect(opt.id)}
              className="px-3 py-1.5 text-[12px] transition-colors"
              style={{
                background: isSel ? "rgba(201, 168, 76, 0.14)" : "transparent",
                color: isSel ? GOLD : "#9aa4b2",
                fontFamily: SERIF,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A labelled row of round color swatches with a highlighted active tone. */
function ColorSwatches({
  label,
  colors,
  selected,
  onSelect,
}: {
  label: string;
  colors: string[];
  selected: string;
  onSelect: (hex: string) => void;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => {
          const isSel = selected.toLowerCase() === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              aria-pressed={isSel}
              aria-label={c}
              title={c}
              onClick={() => onSelect(c)}
              className="h-7 w-7 rounded-full border transition-transform"
              style={{
                background: c,
                borderColor: isSel ? "#f2ede2" : BORDER_DIM,
                borderWidth: isSel ? 2 : 1,
                boxShadow: isSel ? `0 0 0 2px ${c}66` : "none",
                transform: isSel ? "scale(1.1)" : "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Controlled editor for a human {@link UserAvatar}. Renders a live preview of
 * the exact on-floor figure atop a compact set of controls — gender
 * presentation, wardrobe, accent, display name, and role. Every change calls
 * `onChange` with the next avatar; the component holds no state of its own, so
 * the parent owns persistence (e.g. writing to Supabase `user_metadata`).
 *
 * Styled to match the rest of the Executive Floor UI: dark panel, gold serif
 * labels, and accent-highlighted selections.
 */
export function UserCharacterSelector({
  value,
  onChange,
  onSave,
  saving,
  bare = false,
}: {
  value: UserAvatar;
  onChange: (next: UserAvatar) => void;
  onSave?: () => void;
  saving?: boolean;
  /** Drop the panel's own border/background/padding when hosted in a modal shell. */
  bare?: boolean;
}) {
  const selectedAccent = value.accent;
  const preset = presentationDefaults(value.genderStyle);
  const curBuild = value.build ?? preset.build;
  const curHairStyle = value.hairStyle ?? preset.hairStyle;
  const curSkin = effectiveSkin(value);
  const curHair = effectiveHair(value);

  return (
    <div
      className={bare ? "flex flex-col gap-4" : "flex flex-col gap-4 rounded-lg border p-4"}
      style={bare ? undefined : { background: PANEL_BG, borderColor: BORDER }}
    >
      {/* Live preview */}
      <div className="flex items-center gap-3">
        <span
          className="grid h-[84px] w-[84px] place-items-center overflow-hidden rounded-md border"
          style={{ background: PANEL_BG, borderColor: BORDER_DIM }}
        >
          <AvatarPreview spec={userAvatarSpec(value)} size={80} />
        </span>
        <div className="flex flex-col">
          <span className="text-base font-semibold" style={{ color: "#f2ede2", fontFamily: SERIF }}>
            {value.displayName || "You"}
          </span>
          <span className="text-[12px]" style={{ color: GOLD, fontFamily: SERIF }}>
            {value.roleLabel}
          </span>
        </div>
      </div>

      {/* Presets — one-click curated looks. Appearance only: the operator's
          display name and role are preserved so identity survives a re-style. */}
      <div>
        <SectionLabel>Presets</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {AVATAR_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(applyAvatarPreset(value, p))}
              className="rounded-md border px-2.5 py-1 text-[11px] transition-colors hover:brightness-125"
              style={{ borderColor: BORDER_DIM, color: "#cbd2dc", fontFamily: SERIF, background: "transparent" }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Presentation preset — seeds hair-style + build, each overridable below. */}
      <Segmented
        label="Presentation"
        options={GENDER_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
        selected={value.genderStyle}
        onSelect={(id) => onChange({ ...value, genderStyle: id, ...presentationDefaults(id) })}
      />

      {/* Body + hair silhouette — independent overrides of the preset. */}
      <div className="flex flex-wrap gap-4">
        <Segmented
          label="Build"
          options={BUILDS.map((b) => ({ id: b, label: BUILD_LABELS[b] }))}
          selected={curBuild}
          onSelect={(b) => onChange({ ...value, build: b })}
        />
        <Segmented
          label="Hair style"
          options={HAIR_STYLES.map((h) => ({ id: h, label: HAIR_STYLE_LABELS[h] }))}
          selected={curHairStyle}
          onSelect={(h) => onChange({ ...value, hairStyle: h })}
        />
      </div>

      {/* Eyewear + facial hair — new drawn features (front + profile). */}
      <div className="flex flex-wrap gap-4">
        <Segmented
          label="Glasses"
          options={GLASSES_OPTIONS.map((o) => ({ id: o, label: GLASSES_LABELS[o] }))}
          selected={value.glasses ?? "none"}
          onSelect={(o) => onChange({ ...value, glasses: o })}
        />
        <Segmented
          label="Facial hair"
          options={FACIAL_HAIR_OPTIONS.map((o) => ({ id: o, label: FACIAL_HAIR_LABELS[o] }))}
          selected={value.facialHair ?? "none"}
          onSelect={(o) => onChange({ ...value, facialHair: o })}
        />
      </div>

      {/* Skin tone + hair color */}
      <div className="flex flex-wrap gap-4">
        <ColorSwatches label="Skin tone" colors={SKIN_TONES} selected={curSkin} onSelect={(c) => onChange({ ...value, skin: c })} />
        <ColorSwatches label="Hair color" colors={HAIR_COLORS} selected={curHair} onSelect={(c) => onChange({ ...value, hair: c })} />
      </div>

      {/* Wardrobe swatches */}
      <div>
        <SectionLabel>Wardrobe</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {WARDROBES.map((w) => {
            const selected = value.wardrobe === w.id;
            return (
              <button
                key={w.id}
                type="button"
                aria-pressed={selected}
                aria-label={w.label}
                title={w.label}
                onClick={() => onChange({ ...value, wardrobe: w.id })}
                className="h-9 w-9 rounded-md border transition-transform"
                style={{
                  background: cssHex(w.suit),
                  borderColor: selected ? GOLD : BORDER_DIM,
                  borderWidth: selected ? 2 : 1,
                  boxShadow: selected ? `0 0 0 1px ${GOLD}55` : "none",
                  transform: selected ? "scale(1.06)" : "none",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Accent swatches */}
      <div>
        <SectionLabel>Accent</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {AVATAR_ACCENTS.map((accent) => {
            const selected = selectedAccent === accent;
            return (
              <button
                key={accent}
                type="button"
                aria-pressed={selected}
                aria-label={accent}
                title={accent}
                onClick={() => onChange({ ...value, accent })}
                className="h-7 w-7 rounded-full border transition-transform"
                style={{
                  background: accent,
                  borderColor: selected ? "#f2ede2" : BORDER_DIM,
                  borderWidth: selected ? 2 : 1,
                  boxShadow: selected ? `0 0 0 2px ${accent}66` : "none",
                  transform: selected ? "scale(1.1)" : "none",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Display name + role */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5">
          <SectionLabel>Display name</SectionLabel>
          <input
            type="text"
            value={value.displayName}
            maxLength={40}
            onChange={(e) => onChange({ ...value, displayName: e.target.value })}
            placeholder="You"
            className="rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
            style={{ background: "#12100c", borderColor: BORDER_DIM, color: "#f2ede2" }}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5">
          <SectionLabel>Role</SectionLabel>
          <select
            value={value.roleLabel}
            onChange={(e) => onChange({ ...value, roleLabel: e.target.value })}
            className="rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
            style={{ background: "#12100c", borderColor: BORDER_DIM, color: "#f2ede2" }}
          >
            {ROLE_LABELS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Save */}
      {onSave ? (
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="self-start rounded-md border px-4 py-1.5 text-[12px] uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: "rgba(201, 168, 76, 0.12)",
            borderColor: GOLD,
            color: GOLD,
            fontFamily: SERIF,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      ) : null}
    </div>
  );
}
