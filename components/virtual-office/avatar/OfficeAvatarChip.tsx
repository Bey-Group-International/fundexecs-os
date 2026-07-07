"use client";

import { useEffect, useState } from "react";
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

  // Keep the working draft in sync when the committed avatar changes elsewhere.
  useEffect(() => setDraft(avatar), [avatar]);

  const save = async () => {
    setSaving(true);
    const res = await saveOfficeAvatar(draft);
    setSaving(false);
    if (!res?.error) {
      onSaved(draft);
      setOpen(false);
    }
  };

  const selector = open ? (
    <>
      <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
      <div className={`absolute z-40 w-max max-w-[340px] ${compact ? "left-0 top-full mt-1" : "right-0 mt-2"}`}>
        <UserCharacterSelector value={draft} onChange={setDraft} onSave={save} saving={saving} />
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
        {selector}
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
      {selector}
    </div>
  );
}
