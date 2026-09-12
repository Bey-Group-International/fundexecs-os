"use client";

import { useEffect, useRef, useState } from "react";
import { AVATAR_PICKER_ACCEPT, avatarInitial, safeAvatarUrl } from "@/lib/avatar";
import { encodeAvatar } from "./avatar-encode";
import { uploadAvatar, removeAvatar } from "./avatar-actions";

// The one member-photo control, shared by Build > Team, /settings, and
// onboarding. Before this existed each screen had its own idea of what a photo
// was -- a URL box here, a base64 data URL there -- and they disagreed on
// screen.
//
// Two modes:
//  - immediate (default): picking a file uploads it and saves the profile now.
//  - deferred (`onFileSelected` given): the encoded file is handed to the
//    parent, which uploads later. Onboarding needs this, because the member
//    picks a photo on step 1 and the org that owns the storage folder does not
//    exist until the final step.

const SIZE_CLASS = {
  sm: "h-10 w-10 text-sm",
  md: "h-16 w-16 text-lg",
} as const;

export interface AvatarUploadProps {
  /** Member's name -- drives the initials fallback. */
  name: string | null;
  /** Currently stored photo URL, if any. */
  currentUrl?: string | null;
  /** Whose photo this is. Omit for the signed-in member's own. */
  principalId?: string;
  /** Deferred mode: receives the encoded JPEG (or null when cleared). */
  onFileSelected?: (file: File | null) => void;
  size?: keyof typeof SIZE_CLASS;
  /** Hide the Remove control (onboarding has nothing stored to remove yet). */
  allowRemove?: boolean;
}

export function AvatarUpload({
  name,
  currentUrl = null,
  principalId,
  onFileSelected,
  size = "sm",
  allowRemove = true,
}: AvatarUploadProps) {
  const deferred = typeof onFileSelected === "function";
  const fileRef = useRef<HTMLInputElement>(null);

  // A local blob preview wins over the stored URL: the stored object path is
  // deterministic, so a freshly replaced photo keeps its URL and the CDN would
  // otherwise keep serving the previous bytes.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [storedUrl, setStoredUrl] = useState<string | null>(currentUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setStoredUrl(currentUrl), [currentUrl]);

  // Release the object URL when it is replaced or the control unmounts.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const shown = localPreview ?? safeAvatarUrl(storedUrl);
  const hasPhoto = Boolean(shown);

  async function onPick(file: File) {
    setError("");
    setPending(true);
    try {
      const encoded = await encodeAvatar(file);
      if ("error" in encoded) {
        setError(encoded.error);
        return;
      }

      if (deferred) {
        setLocalPreview(encoded.previewUrl);
        onFileSelected?.(encoded.file);
        return;
      }

      const fd = new FormData();
      fd.append("file", encoded.file);
      if (principalId) fd.append("principal_id", principalId);
      const result = await uploadAvatar(fd);
      if (result.error) {
        URL.revokeObjectURL(encoded.previewUrl);
        setError(result.error);
        return;
      }
      setLocalPreview(encoded.previewUrl);
      setStoredUrl(result.url ?? null);
    } finally {
      setPending(false);
      // Let the same file be picked again after an error or a remove.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRemove() {
    setError("");
    setLocalPreview(null);

    if (deferred) {
      onFileSelected?.(null);
      return;
    }

    setPending(true);
    try {
      const fd = new FormData();
      if (principalId) fd.append("principal_id", principalId);
      const result = await removeAvatar(fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStoredUrl(null);
    } finally {
      setPending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt={name ? `${name}'s photo` : "Profile photo"}
            className={`${SIZE_CLASS[size]} shrink-0 rounded-full border border-line object-cover`}
          />
        ) : (
          <span
            className={`${SIZE_CLASS[size]} flex shrink-0 items-center justify-center rounded-full bg-gold-500/20 font-medium text-gold-300`}
          >
            {avatarInitial(name)}
          </span>
        )}

        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary disabled:opacity-50"
          >
            {pending ? "Uploading…" : hasPhoto ? "Change photo" : "Upload photo"}
          </button>
          {hasPhoto && allowRemove ? (
            <button
              type="button"
              disabled={pending}
              onClick={onRemove}
              className="text-left text-[11px] text-fg-muted transition hover:text-status-danger disabled:opacity-50"
            >
              Remove
            </button>
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={AVATAR_PICKER_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPick(file);
          }}
        />
      </div>
      {error ? <p className="text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}
