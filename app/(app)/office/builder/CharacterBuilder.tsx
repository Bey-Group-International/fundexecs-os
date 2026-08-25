"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_DISPLAY_NAME,
  STATUSES,
  initialsFor,
  statusHex,
  statusLabel,
  type AvatarConfig,
} from "@/lib/office/avatarConfig";
import { CHARACTER_PRESETS, getCharacterPreset } from "@/lib/office/characterPresets";
import { PresetSprite } from "@/components/office/PresetSprite";
import { saveAvatarConfig } from "./actions";

const labelCls = "font-mono text-[11px] uppercase tracking-wider text-fg-muted";
const FIRST_PRESET = CHARACTER_PRESETS[0].id;

// The office character is always one of the ready-made presets, so make sure a
// valid one is selected (default to the first) — a config with no/unknown
// preset (e.g. an older custom avatar) falls back to it.
function withPreset(c: AvatarConfig): AvatarConfig {
  return getCharacterPreset(c.preset) ? c : { ...c, preset: FIRST_PRESET };
}

export function CharacterBuilder({
  initial,
  hasSaved,
}: {
  initial: AvatarConfig;
  hasSaved: boolean;
}) {
  const [config, setConfig] = useState<AvatarConfig>(() => withPreset(initial));
  // The last snapshot known to be persisted (null until the first save), used to
  // drive the dirty state so the Save button reflects real unsaved changes.
  const [saved, setSaved] = useState<AvatarConfig | null>(hasSaved ? initial : null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const preset = getCharacterPreset(config.preset) ?? CHARACTER_PRESETS[0];

  const dirty = useMemo(
    () => saved === null || JSON.stringify(saved) !== JSON.stringify(config),
    [saved, config],
  );

  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  function pickPreset(id: string) {
    setConfig((c) => ({ ...c, preset: id }));
    setError("");
  }

  function shuffle() {
    const others = CHARACTER_PRESETS.filter((p) => p.id !== config.preset);
    const pick = others[Math.floor(Math.random() * others.length)] ?? CHARACTER_PRESETS[0];
    pickPreset(pick.id);
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
        setConfig(withPreset(res.config));
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
            <PresetSprite atlas={preset.atlas} size={200} className="relative" />
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
          <button
            onClick={shuffle}
            disabled={pending}
            className="w-full rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-50"
          >
            Shuffle
          </button>
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

        {/* ── Ready-made characters ── */}
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
                    className={`text-center text-[11px] leading-tight ${
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
