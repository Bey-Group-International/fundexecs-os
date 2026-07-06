"use client";

import {
  AVATAR_ACCENTS,
  ROLE_LABELS,
  WARDROBES,
  userAvatarSpec,
  type UserAvatar,
} from "@/lib/office/userAvatar";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";

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
}: {
  value: UserAvatar;
  onChange: (next: UserAvatar) => void;
  onSave?: () => void;
  saving?: boolean;
}) {
  const selectedAccent = value.accent;

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border p-4"
      style={{ background: PANEL_BG, borderColor: BORDER }}
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

      {/* Gender segmented control */}
      <div>
        <SectionLabel>Presentation</SectionLabel>
        <div
          className="inline-flex overflow-hidden rounded-md border"
          role="group"
          aria-label="Presentation"
          style={{ borderColor: BORDER_DIM }}
        >
          {GENDER_OPTIONS.map((opt) => {
            const selected = value.genderStyle === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...value, genderStyle: opt.id })}
                className="px-3.5 py-1.5 text-[12px] transition-colors"
                style={{
                  background: selected ? "rgba(201, 168, 76, 0.14)" : "transparent",
                  color: selected ? GOLD : "#9aa4b2",
                  fontFamily: SERIF,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
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
