"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  NATIVE_TEMPLATES,
  effectLabel,
  templateById,
  validateBackgroundUpload,
  type BackgroundEffect,
  type BackgroundTemplate,
} from "@/lib/meetings/backgrounds";
import { paintTemplate } from "@/lib/meetings/background-processor";
import {
  addBackground,
  deleteBackground,
  listBackgrounds,
  type StoredBackground,
} from "@/lib/meetings/background-store";

/** A template rendered small, using the same painter the camera frame uses. */
function TemplateThumb({ template }: { template: BackgroundTemplate }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    paintTemplate(ctx, template, canvas.width, canvas.height);
  }, [template]);
  return <canvas ref={ref} width={128} height={72} className="w-full h-full object-cover" />;
}

function Tile({
  selected, onClick, label, title, children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-pressed={selected}
      className={`group relative aspect-video w-full overflow-hidden rounded-lg border text-left transition-colors ${
        selected
          ? "border-[var(--gold-400)] ring-1 ring-[var(--gold-400)]"
          : "border-[var(--line)] hover:border-[var(--gold-400)]/50"
      }`}
    >
      {children}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {label}
      </span>
    </button>
  );
}

function BlurThumb({ heavy }: { heavy: boolean }) {
  // Suggests the effect rather than previewing it: a real preview would need
  // the camera running inside the picker, which is a second video pipeline for
  // a thumbnail. The blur here is CSS on a stand-in scene.
  return (
    <div className="absolute inset-0 bg-[var(--surface-3)]">
      <div
        className="absolute inset-0"
        style={{
          filter: `blur(${heavy ? 7 : 3}px)`,
          background:
            "radial-gradient(circle at 30% 40%, rgb(29 78 216 / 0.55), transparent 55%), radial-gradient(circle at 70% 65%, rgb(217 119 6 / 0.45), transparent 55%)",
        }}
      />
    </div>
  );
}

export function BackgroundPicker({
  effect, onChange, unavailable, notice,
}: {
  effect: BackgroundEffect;
  /** The blob accompanies a custom pick so the caller need not re-read the store. */
  onChange: (effect: BackgroundEffect, image?: Blob | null) => void;
  /** Segmentation could not load — effects cannot be offered on this device. */
  unavailable?: boolean;
  /** Why an effect switched itself off, if it did. */
  notice?: string | null;
}) {
  const [custom, setCustom] = useState<StoredBackground[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const rows = await listBackgrounds();
    setCustom(rows);
    setUrls((prev) => {
      // Revoke the urls for rows that have gone, mint them for rows that arrived.
      const next: Record<string, string> = {};
      for (const row of rows) next[row.id] = prev[row.id] ?? URL.createObjectURL(row.blob);
      for (const [id, url] of Object.entries(prev)) if (!next[id]) URL.revokeObjectURL(url);
      return next;
    });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Object URLs outlive the component unless they are revoked; a picker opened
  // and closed a dozen times during a call would otherwise hold every image.
  const urlsRef = useRef(urls);
  useEffect(() => { urlsRef.current = urls; }, [urls]);
  useEffect(() => () => { Object.values(urlsRef.current).forEach(URL.revokeObjectURL); }, []);

  const upload = async (file: File) => {
    const check = validateBackgroundUpload(file);
    if (!check.ok) { setError(check.reason); return; }
    setError(null);
    setBusy(true);
    const saved = await addBackground(file);
    setBusy(false);
    if (!saved) {
      setError("This browser would not store the image — private windows block it.");
      return;
    }
    await refresh();
    onChange({ kind: "custom", id: saved.id }, saved.blob);
  };

  const remove = async (row: StoredBackground) => {
    await deleteBackground(row.id);
    if (effect.kind === "custom" && effect.id === row.id) onChange({ kind: "none" });
    await refresh();
  };

  if (unavailable) {
    return (
      <p className="text-xs text-[var(--fg-muted)]">
        Background effects aren&apos;t available on this device or browser. Your camera is unaffected.
      </p>
    );
  }

  const isSelected = (candidate: BackgroundEffect) =>
    effect.kind === candidate.kind &&
    ("strength" in candidate ? "strength" in effect && effect.strength === candidate.strength : true) &&
    ("id" in candidate ? "id" in effect && effect.id === candidate.id : true);

  return (
    <div className="flex flex-col gap-2">
      {notice && (
        <p className="rounded-lg border border-[var(--status-warning)]/30 bg-[var(--status-warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--fg-secondary)]">
          {notice}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Tile selected={isSelected({ kind: "none" })} onClick={() => onChange({ kind: "none" })} label="None">
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-2)] text-[var(--fg-muted)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 20 L20 4" /><circle cx="12" cy="12" r="9" />
            </svg>
          </div>
        </Tile>

        <Tile
          selected={isSelected({ kind: "blur", strength: "light" })}
          onClick={() => onChange({ kind: "blur", strength: "light" })}
          label="Slight blur"
        >
          <BlurThumb heavy={false} />
        </Tile>

        <Tile
          selected={isSelected({ kind: "blur", strength: "heavy" })}
          onClick={() => onChange({ kind: "blur", strength: "heavy" })}
          label="Extra blur"
        >
          <BlurThumb heavy />
        </Tile>

        {NATIVE_TEMPLATES.map((template) => (
          <Tile
            key={template.id}
            selected={isSelected({ kind: "template", id: template.id })}
            onClick={() => onChange({ kind: "template", id: template.id })}
            label={template.name}
          >
            <TemplateThumb template={template} />
          </Tile>
        ))}

        {custom.map((row) => (
          <div key={row.id} className="relative">
            <Tile
              selected={isSelected({ kind: "custom", id: row.id })}
              onClick={() => onChange({ kind: "custom", id: row.id }, row.blob)}
              label={row.name}
              title={row.name}
            >
              {urls[row.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[row.id]} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
            </Tile>
            <button
              type="button"
              onClick={() => void remove(row)}
              title={`Remove ${row.name}`}
              aria-label={`Remove ${row.name}`}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[11px] text-white opacity-0 transition-opacity hover:bg-[var(--status-danger)] focus:opacity-100 group-hover:opacity-100 sm:opacity-0"
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--line)] text-[10px] font-medium text-[var(--fg-muted)] transition-colors hover:border-[var(--gold-400)]/50 hover:text-[var(--fg-secondary)] disabled:opacity-50"
        >
          <span className="text-sm leading-none">＋</span>
          {busy ? "Adding…" : "Upload"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />

      {error && <p className="text-[11px] text-[var(--status-danger)]">{error}</p>}

      <p className="text-[11px] text-[var(--fg-muted)]">
        {custom.length > 0
          ? "Uploaded backgrounds stay on this device — they won't follow you to another computer."
          : `Current: ${effectLabel(effect)}`}
      </p>
    </div>
  );
}

/** Re-exported so callers can name a template without importing the catalogue. */
export { templateById };
