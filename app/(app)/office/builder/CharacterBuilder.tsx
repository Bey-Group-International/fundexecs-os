"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ACCESSORIES,
  BODY_TYPES,
  DEFAULT_AVATAR_CONFIG,
  EXPRESSIONS,
  EYEWEAR,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  HOLDING,
  MAX_DISPLAY_NAME,
  OUTFITS,
  OUTFIT_COLORS,
  SKIN_TONES,
  STATUSES,
  initialsFor,
  statusHex,
  statusLabel,
  type AvatarColorOption,
  type AvatarConfig,
  type AvatarOption,
} from "@/lib/office/avatarConfig";
import { CHARACTER_PRESETS, getCharacterPreset } from "@/lib/office/characterPresets";
import { AvatarSprite } from "@/components/office/AvatarSprite";
import { PresetSprite } from "@/components/office/PresetSprite";
import { saveAvatarConfig } from "./actions";

const labelCls = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

function randomFrom<T extends AvatarOption>(catalog: readonly T[]): string {
  return catalog[Math.floor(Math.random() * catalog.length)].id;
}

export function CharacterBuilder({
  initial,
  hasSaved,
}: {
  initial: AvatarConfig;
  hasSaved: boolean;
}) {
  const [config, setConfig] = useState<AvatarConfig>(initial);
  // The last snapshot known to be persisted (null until the first save), used to
  // drive the dirty state so the Save button reflects real unsaved changes.
  const [saved, setSaved] = useState<AvatarConfig | null>(hasSaved ? initial : null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // The custom sprite builder is secondary — hidden unless the member opts in
  // (or already has a custom, preset-less character saved).
  const [showCustom, setShowCustom] = useState(!initial.preset);

  const preset = getCharacterPreset(config.preset);

  const dirty = useMemo(
    () => saved === null || JSON.stringify(saved) !== JSON.stringify(config),
    [saved, config],
  );

  // Name/status don't affect which sprite renders, so they never clear a preset.
  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  // Editing any appearance field means the member wants a custom look, so drop
  // the ready-made preset (the procedural sprite takes over).
  const setLook = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    setConfig((c) => ({ ...c, preset: "", [key]: value }));

  function pickPreset(id: string) {
    setConfig((c) => ({ ...c, preset: id }));
    setError("");
  }

  function shuffle() {
    if (config.preset) {
      // In preset mode, shuffle picks a different ready-made character.
      const others = CHARACTER_PRESETS.filter((p) => p.id !== config.preset);
      const pick = others[Math.floor(Math.random() * others.length)] ?? CHARACTER_PRESETS[0];
      pickPreset(pick.id);
      return;
    }
    setConfig((c) => ({
      ...c,
      preset: "",
      body: randomFrom(BODY_TYPES),
      skin: randomFrom(SKIN_TONES),
      hair: randomFrom(HAIR_STYLES),
      hairColor: randomFrom(HAIR_COLORS),
      facialHair: randomFrom(FACIAL_HAIR),
      expression: randomFrom(EXPRESSIONS),
      outfit: randomFrom(OUTFITS),
      outfitColor: randomFrom(OUTFIT_COLORS),
      eyewear: randomFrom(EYEWEAR),
      headwear: randomFrom(HEADWEAR),
      accessories: randomFrom(ACCESSORIES),
      holding: randomFrom(HOLDING),
    }));
    setError("");
  }

  function reset() {
    setConfig((c) => ({ ...DEFAULT_AVATAR_CONFIG, displayName: c.displayName }));
    setError("");
  }

  function save() {
    setError("");
    startTransition(async () => {
      const res = await saveAvatarConfig(config);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.config) {
        setConfig(res.config);
        setSaved(res.config);
      }
      // Land the freshly-saved character in the office: the save action already
      // revalidated /office, so navigating there re-renders with the new avatar
      // (which then spawns and frames in the CEO office).
      router.push("/office");
    });
  }

  const initials = initialsFor(config.displayName);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">
      {/* ── Live preview ── */}
      <div className="md:sticky md:top-4 md:self-start">
        <div className="fx-card overflow-hidden p-0">
          <div className="relative flex items-center justify-center bg-[#070c16] py-6">
            <div
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                background:
                  "radial-gradient(120% 90% at 50% 20%, rgba(245,215,115,0.06), transparent 60%)",
              }}
            />
            {preset ? (
              <PresetSprite atlas={preset.atlas} size={200} className="relative" />
            ) : (
              <AvatarSprite config={config} size={200} className="relative" />
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-4 py-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-xs font-bold text-[#0b1220]"
              style={{ background: statusHex(config) }}
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg-primary">
                {config.displayName || "Your character"}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: statusHex(config) }}
                />
                {statusLabel(config)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <button
            onClick={save}
            disabled={pending || !dirty}
            className="fx-btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : dirty ? "Save & enter office" : "Saved ✓"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={shuffle}
              disabled={pending}
              className="flex-1 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-50"
            >
              Shuffle
            </button>
            <button
              onClick={reset}
              disabled={pending}
              className="flex-1 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50"
            >
              Reset
            </button>
          </div>
          {error ? (
            <p className="text-xs text-status-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex min-w-0 flex-col gap-6">
        <Group title="Identity">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="displayName" className={labelCls}>
              Display name
            </label>
            <input
              id="displayName"
              value={config.displayName}
              maxLength={MAX_DISPLAY_NAME}
              onChange={(e) => set("displayName", e.target.value.slice(0, MAX_DISPLAY_NAME))}
              placeholder="How your name shows on the floor"
              className="w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
            />
          </div>
          <StatusRow value={config.status} onChange={(v) => set("status", v)} />
        </Group>

        {/* ── Ready-made characters (primary) ── */}
        <Group title="Choose your character">
          <p className="-mt-1 text-xs text-fg-secondary">
            Pick a ready-made office character. It walks the floor in full 16-bit style.
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {CHARACTER_PRESETS.map((p) => {
              const active = p.id === config.preset;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickPreset(p.id)}
                  className={`group flex flex-col items-center gap-1.5 rounded-lg border p-2 transition ${
                    active
                      ? "border-gold-400 bg-gold-500/10 ring-1 ring-gold-500/40"
                      : "border-line hover:border-gold-500/40"
                  }`}
                >
                  <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-md bg-[#070c16]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.portrait}
                      alt={p.label}
                      className="h-full w-full object-contain"
                      style={{ filter: "drop-shadow(0 2px 2px rgba(0,0,0,.4))" }}
                    />
                  </span>
                  <span
                    className={`text-center text-[10px] leading-tight ${
                      active ? "text-gold-200" : "text-fg-secondary"
                    }`}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </Group>

        {/* ── Custom sprite builder (secondary) ── */}
        <div className="fx-card p-4">
          <button
            type="button"
            onClick={() => setShowCustom((s) => !s)}
            aria-expanded={showCustom}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="font-display text-sm font-semibold text-fg-primary">
              Build your own instead
            </span>
            <span className="font-mono text-xs text-fg-muted">{showCustom ? "▾" : "▸"}</span>
          </button>
          {!config.preset && !showCustom ? (
            <p className="mt-1 text-xs text-fg-muted">Custom sprite in use — expand to edit.</p>
          ) : null}
          {config.preset ? (
            <p className="mt-1 text-xs text-fg-muted">
              Editing any option below switches you to a custom sprite.
            </p>
          ) : null}

          {showCustom ? (
            <div className="mt-4 flex flex-col gap-6">
              <Subgroup title="Appearance">
                <ChipRow label="Build" options={BODY_TYPES} value={config.body} onChange={(v) => setLook("body", v)} />
                <SwatchRow label="Skin tone" options={SKIN_TONES} value={config.skin} onChange={(v) => setLook("skin", v)} />
                <ChipRow label="Hair" options={HAIR_STYLES} value={config.hair} onChange={(v) => setLook("hair", v)} />
                <SwatchRow label="Hair color" options={HAIR_COLORS} value={config.hairColor} onChange={(v) => setLook("hairColor", v)} />
                <ChipRow label="Facial hair" options={FACIAL_HAIR} value={config.facialHair} onChange={(v) => setLook("facialHair", v)} />
                <ChipRow label="Expression" options={EXPRESSIONS} value={config.expression} onChange={(v) => setLook("expression", v)} />
              </Subgroup>

              <Subgroup title="Wardrobe">
                <ChipRow label="Outfit" options={OUTFITS} value={config.outfit} onChange={(v) => setLook("outfit", v)} />
                <SwatchRow label="Outfit color" options={OUTFIT_COLORS} value={config.outfitColor} onChange={(v) => setLook("outfitColor", v)} />
              </Subgroup>

              <Subgroup title="Eyewear & headwear">
                <ChipRow label="Eyewear" options={EYEWEAR} value={config.eyewear} onChange={(v) => setLook("eyewear", v)} />
                <ChipRow label="Headwear" options={HEADWEAR} value={config.headwear} onChange={(v) => setLook("headwear", v)} />
              </Subgroup>

              <Subgroup title="Accessories">
                <ChipRow label="Worn" options={ACCESSORIES} value={config.accessories} onChange={(v) => setLook("accessories", v)} />
                <ChipRow label="Holding" options={HOLDING} value={config.holding} onChange={(v) => setLook("holding", v)} />
              </Subgroup>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fx-card p-4">
      <h2 className="mb-3 font-display text-sm font-semibold text-fg-primary">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Subgroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly AvatarOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.id)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? "border-gold-500/50 bg-gold-500/10 text-gold-200"
                  : "border-line text-fg-secondary hover:border-gold-500/30 hover:text-fg-primary"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwatchRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly AvatarColorOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              title={o.label}
              aria-label={o.label}
              aria-pressed={active}
              onClick={() => onChange(o.id)}
              className={`h-7 w-7 rounded-full border transition ${
                active
                  ? "border-gold-400 ring-2 ring-gold-500/40 ring-offset-1 ring-offset-surface-0"
                  : "border-line hover:border-fg-muted"
              }`}
              style={{ background: o.hex }}
            />
          );
        })}
      </div>
    </div>
  );
}

function StatusRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelCls}>Presence</span>
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.id)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? "border-gold-500/50 bg-gold-500/10 text-gold-200"
                  : "border-line text-fg-secondary hover:border-gold-500/30 hover:text-fg-primary"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: o.hex }} />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
