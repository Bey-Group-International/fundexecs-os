"use client";

import { useRef, useState } from "react";
import { inputClass } from "./DraftWithEarn";
import { AutosaveForm } from "./AutosaveForm";
import { updateBrand } from "./actions";
import { resizeLogo } from "./logo-resize";

// Five curated brand-voice presets. The stored value is the label string.
const VOICE_PRESETS = [
  "Institutional & precise",
  "Visionary & bold",
  "Understated & exclusive",
  "Warm & approachable",
  "Data-driven & analytical",
] as const;

const DARK = "#0B0A08";
const WHITE = "#FFFFFF";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(value: string): string {
  let v = value.trim();
  if (!v) return "";
  if (!v.startsWith("#")) v = `#${v}`;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  return v.toLowerCase();
}

function isValidHex(value: string): boolean {
  return HEX_RE.test(normalizeHex(value));
}

// Relative luminance per WCAG 2.x.
function luminance(hex: string): number {
  const h = normalizeHex(hex).slice(1);
  const rgb = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function ContrastBadge({ label, ratio }: { label: string; ratio: number }) {
  const pass = ratio >= 4.5;
  return (
    <span
      title={
        pass
          ? "WCAG AA ✓ — meets readability standard for LP materials (≥4.5:1 contrast ratio)"
          : "Below WCAG AA threshold (4.5:1). Text on LP materials may be hard to read — consider a darker or lighter shade."
      }
      className={`inline-flex cursor-help items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
        pass
          ? "border-status-success/40 bg-status-success/10 text-status-success"
          : "border-status-warning/40 bg-status-warning/10 text-status-warning"
      }`}
    >
      <span>{label}</span>
      <span>{ratio.toFixed(1)}</span>
      <span>{pass ? "AA ✓" : "low"}</span>
    </span>
  );
}

type BrandStudioProps = {
  logoUrl: string;
  brandColor: string;
  tagline: string;
  brandVoice: string;
  brandPalette: string[];
  firmName: string;
};

export function BrandStudio({
  logoUrl,
  brandColor,
  tagline,
  brandVoice,
  brandPalette,
  firmName,
}: BrandStudioProps) {
  const [hasSavedColor, setHasSavedColor] = useState(isValidHex(brandColor));
  const initialColor = isValidHex(brandColor) ? normalizeHex(brandColor) : "#000000";
  const [color, setColor] = useState(initialColor);
  const [palette, setPalette] = useState<string[]>(
    brandPalette.map(normalizeHex).filter(isValidHex),
  );
  const [paletteDraft, setPaletteDraft] = useState("#0b0a08");
  const [logo, setLogo] = useState(logoUrl ?? "");
  const [logoError, setLogoError] = useState("");
  const [voice, setVoice] = useState(
    (VOICE_PRESETS as readonly string[]).includes(brandVoice) ? brandVoice : "",
  );
  const [taglineText, setTaglineText] = useState(tagline ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  function pickColor(value: string) {
    const v = normalizeHex(value);
    setColor(v);
    setHasSavedColor(true);
  }

  function addToPalette(hex: string) {
    const v = normalizeHex(hex);
    if (!isValidHex(v)) return;
    setPalette((prev) => (prev.includes(v) ? prev : [...prev, v]));
  }

  function removeFromPalette(hex: string) {
    setPalette((prev) => prev.filter((c) => c !== hex));
  }

  async function onLogoFile(file: File) {
    setLogoError("");
    const result = await resizeLogo(file);
    if ("error" in result) {
      setLogoError(result.error);
    } else {
      setLogo(result.dataUrl);
    }
  }

  function removeLogo() {
    setLogo("");
    setLogoError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const darkRatio = isValidHex(color) ? contrastRatio(color, DARK) : 0;
  const whiteRatio = isValidHex(color) ? contrastRatio(color, WHITE) : 0;
  const initial = (firmName || "F").charAt(0).toUpperCase();

  return (
    <AutosaveForm action={updateBrand} className="grid max-w-2xl gap-6 pt-5">
      {/* Only submit brand_color when a color has been explicitly chosen. */}
      <input type="hidden" name="brand_color" value={hasSavedColor ? (isValidHex(color) ? color : "") : ""} />
      <input type="hidden" name="brand_palette" value={palette.join(",")} />
      <input type="hidden" name="logo_url" value={logo} />
      <input type="hidden" name="brand_voice" value={voice} />
      <input type="hidden" name="tagline" value={taglineText} />

      {/* Tagline */}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-fg-secondary">Tagline</span>
        <input
          value={taglineText}
          onChange={(e) => setTaglineText(e.target.value)}
          placeholder="One line that captures the firm"
          className={inputClass}
        />
      </label>

      {/* Primary color */}
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-fg-secondary">Primary color</span>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label="Pick primary color"
            value={isValidHex(color) ? color : "#000000"}
            onChange={(e) => pickColor(e.target.value)}
            className="h-10 w-12 cursor-pointer rounded-md border border-line bg-surface-0 p-1"
          />
          {hasSavedColor && isValidHex(color) ? (
            <span className="select-all font-mono text-xs text-fg-secondary">{color}</span>
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              Not set — open the picker
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <ContrastBadge label="on dark" ratio={darkRatio} />
            <ContrastBadge label="on white" ratio={whiteRatio} />
          </div>
        </div>
        {isValidHex(color) && hasSavedColor && (whiteRatio < 4.5 || darkRatio < 4.5) ? (
          <p className="text-[11px] text-status-warning">
            Fails AA on{" "}
            {[darkRatio < 4.5 && "dark backgrounds", whiteRatio < 4.5 && "white backgrounds"]
              .filter(Boolean)
              .join(" & ")}{" "}
            — try a darker shade to reach ≥4.5:1.
          </p>
        ) : (
          <p className="text-[11px] text-fg-muted">
            WCAG AA readability scores — hover a badge for details.
          </p>
        )}
      </div>

      {/* Palette */}
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-fg-secondary">Palette</span>
        <p className="text-[11px] text-fg-muted">
          Open the picker and choose a color — it's added instantly.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {/* Palette picker — adds on blur (when you close the picker) */}
          <input
            type="color"
            aria-label="Pick a palette color"
            value={isValidHex(paletteDraft) ? normalizeHex(paletteDraft) : "#000000"}
            onChange={(e) => setPaletteDraft(e.target.value)}
            onBlur={() => addToPalette(paletteDraft)}
            className="h-10 w-12 cursor-pointer rounded-md border border-line bg-surface-0 p-1"
          />
          {palette.map((c) => (
            <div key={c} className="group relative">
              <button
                type="button"
                title={`Set ${c} as primary`}
                onClick={() => pickColor(c)}
                className="h-10 w-10 rounded-md border-2 border-transparent transition hover:border-gold-500/60"
                style={{ backgroundColor: c }}
              />
              <button
                type="button"
                aria-label={`Remove ${c}`}
                onClick={() => removeFromPalette(c)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] leading-none text-fg-secondary opacity-0 transition group-hover:opacity-100 hover:bg-status-danger/20 hover:text-status-danger"
              >
                ×
              </button>
            </div>
          ))}
          {palette.length === 0 && (
            <p className="text-xs text-fg-muted">No colors yet.</p>
          )}
        </div>
        {palette.length > 0 && (
          <p className="text-[11px] text-fg-muted">
            Click a swatch to set it as primary. Hover to remove.
          </p>
        )}
      </div>

      {/* Logo */}
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-fg-secondary">Logo</span>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onLogoFile(f);
            }}
            className="text-xs text-fg-secondary file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:text-fg-primary"
          />
          {logo ? (
            <button
              type="button"
              onClick={removeLogo}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger"
            >
              Remove logo
            </button>
          ) : null}
        </div>
        {logoError ? <p className="text-xs text-status-danger">{logoError}</p> : null}
        <p className="text-[11px] text-fg-muted">
          Images are downscaled to 512px and stored inline — no upload server needed.
        </p>
      </div>

      {/* Brand voice */}
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-fg-secondary">Brand voice</span>
        <div className="flex flex-wrap gap-2">
          {VOICE_PRESETS.map((preset) => {
            const selected = voice === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                onClick={() => setVoice(selected ? "" : preset)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  selected
                    ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                    : "border-line bg-surface-0 text-fg-secondary hover:border-gold-500/40"
                }`}
              >
                {preset}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live preview */}
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-fg-secondary">Live preview</span>
        <div className="rounded-xl border border-line bg-surface-1 p-5">
          <div className="flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={`${firmName} logo`} className="h-12 w-12 shrink-0 rounded-lg object-contain" />
            ) : (
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-display text-xl font-semibold"
                style={{
                  backgroundColor: isValidHex(color) ? color : "#d4af6a",
                  color: darkRatio >= whiteRatio ? DARK : WHITE,
                }}
              >
                {initial}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold tracking-tight text-fg-primary">
                {firmName || "Your Firm"}
              </p>
              {taglineText ? (
                <p className="truncate text-sm text-fg-secondary">{taglineText}</p>
              ) : (
                <p className="text-sm text-fg-muted">Add a tagline to see it here</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span
              className="h-7 w-7 rounded-md border border-line"
              style={{ backgroundColor: isValidHex(color) ? color : undefined }}
              title={`Primary ${color}`}
            />
            {palette.map((c) => (
              <span
                key={c}
                className="h-7 w-7 rounded-md border border-line"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          {voice ? (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              Voice · {voice}
            </p>
          ) : null}
        </div>
      </div>
    </AutosaveForm>
  );
}
