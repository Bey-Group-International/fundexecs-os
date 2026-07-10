"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";
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
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
            <div
              className="relative flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-[380px] flex-col overflow-hidden rounded-xl border"
              style={{ borderColor: "rgba(201,168,76,0.35)", background: "#0a0806" }}
              role="dialog"
              aria-label="Customize your character"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #c9a84c, transparent)" }} />
              <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "rgba(201,168,76,0.18)" }}>
                <span className="text-[11px] uppercase tracking-[0.22em]" style={{ color: "#c9a84c", fontFamily: "Georgia, serif" }}>
                  Your character
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
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
                <UserCharacterSelector value={draft} onChange={setDraft} onSave={save} saving={saving} bare />
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
