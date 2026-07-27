"use client";

import { useMemo, useState, useTransition } from "react";
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
import { AvatarSprite } from "@/components/office/AvatarSprite";
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

  const dirty = useMemo(
    () => saved === null || JSON.stringify(saved) !== JSON.stringify(config),
    [saved, config],
  );

  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  function shuffle() {
    setConfig((c) => ({
      ...c,
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
            <AvatarSprite config={config} size={200} className="relative" />
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
            {pending ? "Saving…" : dirty ? "Save character" : "Saved ✓"}
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

        <Group title="Appearance">
          <ChipRow label="Build" options={BODY_TYPES} value={config.body} onChange={(v) => set("body", v)} />
          <SwatchRow label="Skin tone" options={SKIN_TONES} value={config.skin} onChange={(v) => set("skin", v)} />
          <ChipRow label="Hair" options={HAIR_STYLES} value={config.hair} onChange={(v) => set("hair", v)} />
          <SwatchRow label="Hair color" options={HAIR_COLORS} value={config.hairColor} onChange={(v) => set("hairColor", v)} />
          <ChipRow label="Facial hair" options={FACIAL_HAIR} value={config.facialHair} onChange={(v) => set("facialHair", v)} />
          <ChipRow label="Expression" options={EXPRESSIONS} value={config.expression} onChange={(v) => set("expression", v)} />
        </Group>

        <Group title="Wardrobe">
          <ChipRow label="Outfit" options={OUTFITS} value={config.outfit} onChange={(v) => set("outfit", v)} />
          <SwatchRow label="Outfit color" options={OUTFIT_COLORS} value={config.outfitColor} onChange={(v) => set("outfitColor", v)} />
        </Group>

        <Group title="Eyewear & headwear">
          <ChipRow label="Eyewear" options={EYEWEAR} value={config.eyewear} onChange={(v) => set("eyewear", v)} />
          <ChipRow label="Headwear" options={HEADWEAR} value={config.headwear} onChange={(v) => set("headwear", v)} />
        </Group>

        <Group title="Accessories">
          <ChipRow label="Worn" options={ACCESSORIES} value={config.accessories} onChange={(v) => set("accessories", v)} />
          <ChipRow label="Holding" options={HOLDING} value={config.holding} onChange={(v) => set("holding", v)} />
        </Group>
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
