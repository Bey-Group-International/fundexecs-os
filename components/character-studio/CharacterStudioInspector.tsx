"use client";

import {
  type UserAvatar,
  WARDROBES,
  AVATAR_ACCENTS,
  SKIN_TONES,
  HAIR_COLORS,
  HAIR_STYLES,
  BUILDS,
  GLASSES_OPTIONS,
  FACIAL_HAIR_OPTIONS,
  ROLE_LABELS,
  AVATAR_PRESETS,
  applyAvatarPreset,
  presentationDefaults,
  effectiveSkin,
  effectiveHair,
} from "@/lib/office/userAvatar";
import { userAvatarSpec } from "@/lib/office/userAvatar";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";
import { SectionHeading, FieldLabel, OptionPills, ColorSwatches } from "./controls";

export type StudioSection = "identity" | "body" | "face" | "hair" | "wardrobe" | "role" | "presets";

export const STUDIO_SECTIONS: { id: StudioSection; label: string; icon: string }[] = [
  { id: "presets", label: "Saved Looks", icon: "★" },
  { id: "identity", label: "Identity", icon: "◈" },
  { id: "body", label: "Body", icon: "◲" },
  { id: "face", label: "Face", icon: "☺" },
  { id: "hair", label: "Hair", icon: "≈" },
  { id: "wardrobe", label: "Wardrobe", icon: "▤" },
  { id: "role", label: "Executive Role", icon: "♦" },
];

const GOLD = "#c9a84c";
const fieldCls =
  "w-full rounded-md border bg-transparent px-2.5 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#c9a84c80]";
const fieldStyle = { borderColor: "rgba(255,255,255,0.12)" } as const;

/** The contextual right-panel controls for the active studio section. */
export function CharacterStudioInspector({
  section,
  value,
  onChange,
}: {
  section: StudioSection;
  value: UserAvatar;
  onChange: (next: UserAvatar) => void;
}) {
  const curSkin = effectiveSkin(value);
  const curHair = effectiveHair(value);

  switch (section) {
    case "presets":
      return (
        <div className="space-y-3">
          <SectionHeading>Saved Looks</SectionHeading>
          <p className="text-[11px] text-slate-500">
            Start from a curated executive look, then refine. Your name and role are preserved.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {AVATAR_PRESETS.map((p) => {
              const spec = userAvatarSpec(applyAvatarPreset(value, p));
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange(applyAvatarPreset(value, p))}
                  className="flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 transition-colors hover:border-[#c9a84c66]"
                  style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
                >
                  <AvatarPreview spec={spec} size={64} />
                  <span className="text-[11px] text-slate-200" style={{ fontFamily: "Georgia, serif" }}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      );

    case "identity":
      return (
        <div className="space-y-3">
          <SectionHeading>Identity</SectionHeading>
          <label className="block">
            <FieldLabel>Display name</FieldLabel>
            <input
              className={fieldCls}
              style={fieldStyle}
              value={value.displayName}
              maxLength={40}
              onChange={(e) => onChange({ ...value, displayName: e.target.value })}
            />
          </label>
          <label className="block">
            <FieldLabel>Executive role</FieldLabel>
            <select
              className={fieldCls}
              style={fieldStyle}
              value={value.roleLabel}
              onChange={(e) => onChange({ ...value, roleLabel: e.target.value })}
            >
              {ROLE_LABELS.map((r) => (
                <option key={r} value={r} style={{ background: "#12100c" }}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-500">
            Your name labels your figure on the floor; your role appears beneath it and in workflow panels.
          </p>
        </div>
      );

    case "body":
      return (
        <div className="space-y-3">
          <SectionHeading>Body</SectionHeading>
          <OptionPills
            label="Presentation"
            options={["male", "female", "neutral"] as const}
            value={value.genderStyle}
            onSelect={(g) => onChange({ ...value, genderStyle: g, ...presentationDefaults(g) })}
          />
          <OptionPills
            label="Build"
            options={BUILDS}
            value={value.build ?? presentationDefaults(value.genderStyle).build}
            onSelect={(b) => onChange({ ...value, build: b })}
          />
          <ColorSwatches
            label="Skin tone"
            colors={SKIN_TONES}
            selected={curSkin}
            onSelect={(c) => onChange({ ...value, skin: c })}
          />
        </div>
      );

    case "face":
      return (
        <div className="space-y-3">
          <SectionHeading>Face</SectionHeading>
          <OptionPills
            label="Eyewear"
            options={GLASSES_OPTIONS}
            value={value.glasses ?? "none"}
            onSelect={(o) => onChange({ ...value, glasses: o })}
          />
          <OptionPills
            label="Facial hair"
            options={FACIAL_HAIR_OPTIONS}
            value={value.facialHair ?? "none"}
            onSelect={(o) => onChange({ ...value, facialHair: o })}
          />
        </div>
      );

    case "hair":
      return (
        <div className="space-y-3">
          <SectionHeading>Hair</SectionHeading>
          <OptionPills
            label="Style"
            options={HAIR_STYLES}
            value={value.hairStyle ?? presentationDefaults(value.genderStyle).hairStyle}
            onSelect={(h) => onChange({ ...value, hairStyle: h })}
          />
          <ColorSwatches
            label="Hair color"
            colors={HAIR_COLORS}
            selected={curHair}
            onSelect={(c) => onChange({ ...value, hair: c })}
          />
        </div>
      );

    case "wardrobe":
      return (
        <div className="space-y-3">
          <SectionHeading>Wardrobe</SectionHeading>
          <div>
            <FieldLabel>Suit palette</FieldLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {WARDROBES.map((w) => {
                const active = w.id === value.wardrobe;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onChange({ ...value, wardrobe: w.id })}
                    className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors"
                    style={{
                      borderColor: active ? `${GOLD}90` : "rgba(255,255,255,0.1)",
                      background: active ? `${GOLD}14` : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-sm"
                      style={{ background: `#${w.suit.toString(16).padStart(6, "0")}`, outline: "1px solid rgba(255,255,255,0.15)" }}
                    />
                    <span className="truncate text-[11px]" style={{ color: active ? GOLD : "#cbd2dc" }}>
                      {w.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <ColorSwatches
            label="Signature accent"
            colors={AVATAR_ACCENTS}
            selected={value.accent}
            onSelect={(accent) => onChange({ ...value, accent })}
          />
        </div>
      );

    case "role":
      return (
        <div className="space-y-3">
          <SectionHeading>Executive Role</SectionHeading>
          <OptionPills
            label="Role"
            options={ROLE_LABELS}
            value={value.roleLabel}
            onSelect={(r) => onChange({ ...value, roleLabel: r })}
          />
          <ColorSwatches
            label="Signature accent"
            colors={AVATAR_ACCENTS}
            selected={value.accent}
            onSelect={(accent) => onChange({ ...value, accent })}
          />
          <p className="text-[11px] text-slate-500">
            The role and accent identify you across the Virtual Office — on the floor, in meetings, and beside the
            work you own.
          </p>
        </div>
      );
  }
}
