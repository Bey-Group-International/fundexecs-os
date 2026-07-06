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
}: {
  avatar: UserAvatar;
  onSaved: (a: UserAvatar) => void;
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
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-max max-w-[340px]">
            <UserCharacterSelector value={draft} onChange={setDraft} onSave={save} saving={saving} />
          </div>
        </>
      ) : null}
    </div>
  );
}
