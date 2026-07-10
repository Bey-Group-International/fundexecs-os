"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";

// The 3D studio pulls in three.js + the model — load it only when the studio
// opens (client-only; no SSR for WebGL).
const Avatar3DStudio = dynamic(() => import("@/components/virtual-office/avatar/Avatar3DStudio"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-[10px]" style={{ color: "rgba(201,168,76,0.6)", fontFamily: "Georgia, serif" }}>
      Loading 3D…
    </div>
  ),
});
import { UserCharacterSelector } from "@/components/virtual-office/avatar/UserCharacterSelector";
import { userAvatarSpec, type UserAvatar } from "@/lib/office/userAvatar";
import { saveOfficeAvatar } from "@/app/(app)/settings/actions";

/**
 * The operator's own Executive Floor identity, shown as a chip in the office
 * header. Clicking opens the character selector (gender + wardrobe + accent +
 * name/role); saving persists to user_metadata and hands the committed avatar
 * back so the floor re-renders the player.
 */
export function OfficeAvatarChip({
  avatar,
  onSaved,
  compact = false,
}: {
  avatar: UserAvatar;
  onSaved: (a: UserAvatar) => void;
  /** Slim inline variant for the office top rail (sits beside the other chips). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<UserAvatar>(avatar);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal target is only available after mount (client-only).
  useEffect(() => setMounted(true), []);

  // Keep the working draft in sync when the committed avatar changes elsewhere.
  useEffect(() => setDraft(avatar), [avatar]);

  // Close on Escape while the editor is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const save = async () => {
    setSaving(true);
    const res = await saveOfficeAvatar(draft);
    setSaving(false);
    if (!res?.error) {
      onSaved(draft);
      setOpen(false);
    }
  };

  // The rail chip's editor is a tall (~560px) multi-section form. On the floor
  // it opens as a proper modal — and is PORTALED to document.body so it escapes
  // the floor's transformed stacking context. Anchoring it inline (or even as a
  // `fixed` child of the rail) let the status strip and Phaser overlays bleed
  // over it; a body-level portal renders above everything, clamped to the
  // viewport and scrolled internally. Matches the map editor's contained-modal
  // system. The non-compact (settings) variant keeps its inline dropdown.
  const compactModal =
    open && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-3"
            role="presentation"
            onClick={() => setOpen(false)}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[3px]" />
            {/* Full-screen two-pane studio: a large live HD preview on the left,
                categorized controls on the right. Portaled to body so it clears
                the floor's stacking context. Stacks on narrow screens. */}
            <div
              className="relative flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-[900px] flex-col overflow-hidden rounded-2xl border md:flex-row"
              style={{ borderColor: "rgba(201,168,76,0.35)", background: "#0a0806" }}
              role="dialog"
              aria-label="Character studio"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Left — big HD preview + identity + save */}
              <div
                className="relative flex shrink-0 flex-col items-center gap-4 border-b p-6 md:w-[300px] md:border-b-0 md:border-r"
                style={{
                  borderColor: "rgba(201,168,76,0.18)",
                  background: "radial-gradient(120% 80% at 50% 15%, rgba(201,168,76,0.09), rgba(10,8,6,0) 60%)",
                }}
              >
                <span className="self-start text-[11px] uppercase tracking-[0.22em]" style={{ color: "#c9a84c", fontFamily: "Georgia, serif" }}>
                  Character studio
                </span>
                <span
                  className="mt-2 block h-[232px] w-[232px] overflow-hidden rounded-xl border"
                  style={{ background: "#0c0a07", borderColor: "rgba(201,168,76,0.22)", boxShadow: "inset 0 0 40px rgba(0,0,0,0.55)" }}
                >
                  <Avatar3DStudio accent={draft.accent} />
                </span>
                <div className="flex flex-col items-center">
                  <span className="text-lg font-semibold" style={{ color: "#f2ede2", fontFamily: "Georgia, serif" }}>
                    {draft.displayName || "You"}
                  </span>
                  <span className="text-[12px]" style={{ color: "#c9a84c", fontFamily: "Georgia, serif" }}>
                    {draft.roleLabel}
                  </span>
                </div>
                <div className="mt-auto flex w-full gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-md border py-2 text-[12px] uppercase tracking-[0.12em] text-slate-300 transition-colors hover:bg-white/[0.04]"
                    style={{ borderColor: "rgba(255,255,255,0.12)", fontFamily: "Georgia, serif" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="flex-1 rounded-md border py-2 text-[12px] uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: "rgba(201,168,76,0.14)", borderColor: "#c9a84c", color: "#c9a84c", fontFamily: "Georgia, serif" }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>

              {/* Right — controls */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b px-5 py-2.5" style={{ borderColor: "rgba(201,168,76,0.18)" }}>
                  <span className="text-[11px] uppercase tracking-[0.22em]" style={{ color: "#c9a84c", fontFamily: "Georgia, serif" }}>
                    Customize
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="grid h-6 w-6 place-items-center rounded text-[13px] leading-none text-slate-400 transition-colors hover:text-slate-100"
                    style={{ border: "1px solid rgba(201,168,76,0.3)" }}
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
                  <UserCharacterSelector value={draft} onChange={setDraft} bare hidePreview />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  // Settings-page (non-compact) inline anchored dropdown — unchanged.
  const anchoredSelector = open ? (
    <>
      <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
      <div className="absolute right-0 z-40 mt-2 w-max max-w-[340px]">
        <div className="max-h-[80vh] overflow-y-auto overflow-x-hidden rounded-lg">
          <UserCharacterSelector value={draft} onChange={setDraft} onSave={save} saving={saving} />
        </div>
      </div>
    </>
  ) : null;

  if (compact) {
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Your character: ${avatar.displayName}. Edit character.`}
          title="Edit your character"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors"
          style={{
            fontFamily: "Georgia, serif",
            color: "#cbd2dc",
            background: open ? "rgba(201,168,76,0.12)" : "transparent",
            border: `1px solid ${open ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.05)"}`,
          }}
        >
          <span className="grid h-4 w-4 place-items-center overflow-hidden rounded-sm" style={{ background: "#0a0806" }}>
            <AvatarPreview spec={userAvatarSpec(avatar)} size={16} />
          </span>
          <span className="max-w-[96px] truncate">{avatar.displayName}</span>
          <span aria-hidden className="text-[8px] opacity-70">{open ? "▴" : "▾"}</span>
        </button>
        {compactModal}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Your character: ${avatar.displayName}. Edit character.`}
        className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-colors"
        style={{ background: "rgba(10,8,6,0.7)", borderColor: open ? avatar.accent : "rgba(201,168,76,0.35)" }}
      >
        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-md" style={{ background: "#0a0806" }}>
          <AvatarPreview spec={userAvatarSpec(avatar)} size={28} />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-muted">You</span>
          <span className="text-sm font-semibold text-fg-primary">{avatar.displayName}</span>
        </span>
        <span aria-hidden className="ml-0.5 text-[10px] text-fg-muted transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}>
          ▾
        </span>
      </button>
      {anchoredSelector}
    </div>
  );
}
