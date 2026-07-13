"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { virtualOfficeRoutes } from "@/lib/virtualOfficeRoutes";
import { type UserAvatar, userAvatarSpec } from "@/lib/office/userAvatar";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";
import { saveOfficeAvatar } from "@/app/(app)/settings/actions";
import {
  CharacterStudioInspector,
  STUDIO_SECTIONS,
  type StudioSection,
} from "./CharacterStudioInspector";

const GOLD = "#c9a84c";

/** Preview backdrops — set dressing behind the figure, not a live environment. */
const ENVIRONMENTS: { id: string; label: string; bg: string }[] = [
  { id: "studio", label: "Neutral studio", bg: "radial-gradient(120% 80% at 50% 30%, #1c2130 0%, #0c0e14 75%)" },
  { id: "office", label: "Virtual Office", bg: "radial-gradient(120% 90% at 50% 20%, #2a2418 0%, #12100b 78%)" },
  { id: "meeting", label: "Meeting room", bg: "radial-gradient(120% 90% at 50% 25%, #182430 0%, #0a0f14 78%)" },
];

/** Deep-equal for the small, JSON-serializable UserAvatar. */
function sameAvatar(a: UserAvatar, b: UserAvatar): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The Character Studio — a dedicated three-panel editor for the operator's own
 * 2.5D executive figure. Left: section navigation. Center: a live preview
 * rendered by the same Canvas2D avatar renderer the floor uses. Right:
 * contextual controls for the active section. Reuses the existing AvatarSpec
 * model and `saveOfficeAvatar` persistence (user_metadata) — publishing here is
 * exactly what the floor reads on load.
 */
export function CharacterStudioShell({ initialAvatar }: { initialAvatar: UserAvatar }) {
  const [draft, setDraft] = useState<UserAvatar>(initialAvatar);
  const [saved, setSaved] = useState<UserAvatar>(initialAvatar);
  const [section, setSection] = useState<StudioSection>("presets");
  const [environment, setEnvironment] = useState(ENVIRONMENTS[0]);
  const [zoom, setZoom] = useState(1);
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Undo / redo — bounded history of prior drafts.
  const history = useRef<UserAvatar[]>([]);
  const future = useRef<UserAvatar[]>([]);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  // The working draft is kept in memory only. It is intentionally NOT persisted
  // to localStorage: the avatar carries appearance/presentation fields, and
  // writing those to client storage is both a CodeQL "clear-text storage of
  // sensitive information" flag and against the spec's privacy stance. The seed
  // comes from the server (published avatar) and Publish writes back to the
  // account (user_metadata) — never to local clear-text storage.

  const commit = useCallback((next: UserAvatar) => {
    setDraft((cur) => {
      if (sameAvatar(cur, next)) return cur;
      history.current.push(cur);
      if (history.current.length > 50) history.current.shift();
      future.current = [];
      return next;
    });
    setSaveError(null);
  }, []);

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    setDraft((cur) => {
      future.current.push(cur);
      return prev;
    });
    rerender();
  };
  const redo = () => {
    const nxt = future.current.pop();
    if (!nxt) return;
    setDraft((cur) => {
      history.current.push(cur);
      return nxt;
    });
    rerender();
  };

  const isDirty = useMemo(() => !sameAvatar(draft, saved), [draft, saved]);

  const publish = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveOfficeAvatar(draft);
      if (res?.error) {
        setSaveError(res.error);
      } else {
        setSaved(draft);
      }
    } catch {
      setSaveError("Couldn't publish — please try again.");
    } finally {
      setSaving(false);
    }
  };

  const spec = useMemo(() => userAvatarSpec(draft), [draft]);
  const savedSpec = useMemo(() => userAvatarSpec(saved), [saved]);
  const previewSize = Math.round(240 * zoom);

  const saveStatus = saving ? "Publishing…" : isDirty ? "Unpublished changes" : "Published";

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-line/60 bg-[#0a0c11] text-slate-200">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Character Studio</div>
          <div className="truncate text-[15px] font-semibold text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
            {draft.displayName || "Your avatar"}
          </div>
        </div>
        <span
          className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider"
          style={{
            background: isDirty ? "rgba(201,168,76,0.14)" : "rgba(34,197,94,0.12)",
            color: isDirty ? GOLD : "#4ade80",
          }}
        >
          {saveStatus}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <HeaderBtn onClick={undo} disabled={history.current.length === 0} label="Undo">
            ↶
          </HeaderBtn>
          <HeaderBtn onClick={redo} disabled={future.current.length === 0} label="Redo">
            ↷
          </HeaderBtn>
          <HeaderBtn onClick={() => setCompare((c) => !c)} active={compare} label="Compare with published">
            ⇄
          </HeaderBtn>
          <Link
            href={virtualOfficeRoutes.root}
            className="rounded-md border px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:text-white"
            style={{ borderColor: "rgba(255,255,255,0.14)" }}
          >
            Close
          </Link>
          <button
            type="button"
            onClick={publish}
            disabled={saving || !isDirty}
            className="rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-opacity disabled:opacity-40"
            style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
          >
            {saving ? "Publishing…" : "Publish avatar"}
          </button>
        </div>
      </header>

      {saveError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-[11px] text-red-300">{saveError}</div>
      )}

      {/* Three-panel body */}
      <div className="flex min-h-0 flex-1">
        {/* Left — section navigation */}
        <nav className="w-[168px] shrink-0 overflow-y-auto border-r border-line/60 p-2">
          <Link
            href={virtualOfficeRoutes.characterStudioFromPhoto}
            className="mb-1.5 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.04]"
            style={{ borderColor: `${GOLD}55`, color: GOLD }}
          >
            <span className="w-4 text-center text-[13px]" aria-hidden>
              ⎙
            </span>
            Create from photo
          </Link>
          {STUDIO_SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors"
                style={{
                  background: active ? `${GOLD}16` : "transparent",
                  color: active ? GOLD : "#aab3c0",
                }}
              >
                <span className="w-4 text-center text-[13px]" aria-hidden>
                  {s.icon}
                </span>
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Center — live preview */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-4" style={{ background: environment.bg }}>
          {compare ? (
            <div className="flex items-end gap-6">
              <PreviewFigure label="Published" spec={savedSpec} size={previewSize} />
              <PreviewFigure label="Editing" spec={spec} size={previewSize} highlight />
            </div>
          ) : (
            <AvatarPreview spec={spec} size={previewSize} />
          )}
          <div className="text-[11px] text-slate-400" style={{ fontFamily: "Georgia, serif" }}>
            {draft.displayName || "You"} · {draft.roleLabel}
          </div>

          {/* Preview controls */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {ENVIRONMENTS.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEnvironment(e)}
                className="rounded-md border px-2 py-0.5 text-[10px] transition-colors"
                style={{
                  borderColor: e.id === environment.id ? `${GOLD}80` : "rgba(255,255,255,0.12)",
                  color: e.id === environment.id ? GOLD : "#9aa4b2",
                  background: "rgba(0,0,0,0.25)",
                }}
              >
                {e.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-white/10" />
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.15).toFixed(2)))}
              className="rounded-md border px-2 py-0.5 text-[12px] text-slate-300"
              style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)" }}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}
              className="rounded-md border px-2 py-0.5 text-[12px] text-slate-300"
              style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)" }}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </div>

        {/* Right — contextual controls */}
        <div className="w-[288px] shrink-0 overflow-y-auto border-l border-line/60 p-3.5">
          <CharacterStudioInspector section={section} value={draft} onChange={commit} />
        </div>
      </div>
    </div>
  );
}

function PreviewFigure({
  label,
  spec,
  size,
  highlight,
}: {
  label: string;
  spec: ReturnType<typeof userAvatarSpec>;
  size: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <AvatarPreview spec={spec} size={Math.round(size * 0.82)} />
      <span
        className="rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider"
        style={{
          background: highlight ? "rgba(201,168,76,0.16)" : "rgba(255,255,255,0.06)",
          color: highlight ? GOLD : "#9aa4b2",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function HeaderBtn({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="h-7 w-7 rounded-md border text-[13px] transition-colors disabled:opacity-30"
      style={{
        borderColor: active ? `${GOLD}80` : "rgba(255,255,255,0.14)",
        color: active ? GOLD : "#c2c9d4",
        background: active ? `${GOLD}12` : "transparent",
      }}
    >
      {children}
    </button>
  );
}
