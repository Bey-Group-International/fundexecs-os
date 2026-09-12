"use client";

import { useEffect, useRef, useState } from "react";
import { AVATAR_PICKER_ACCEPT, avatarInitial, safeAvatarUrl } from "@/lib/avatar";
import { encodeAvatar } from "./avatar-encode";
import { uploadAvatar, removeAvatar } from "./avatar-actions";

// The one member-photo control, shared by Build > Team, /settings, and
// onboarding.
//
// The whole circle is the control: click it to pick a file, or drop an image
// on it. With no photo it is simply the member's initials, which is also the
// fallback everywhere else a member is shown.
//
// Two modes:
//  - immediate (default): picking a file uploads it and saves the profile now.
//  - deferred (`onFileSelected` given): the encoded file is handed to the
//    parent, which uploads later. Onboarding needs this, because the member
//    picks a photo on step 1 and the org that owns the storage folder does not
//    exist until the final step.

const SIZE_CLASS = {
  sm: "h-10 w-10 text-sm",
  md: "h-20 w-20 text-xl",
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
  const [dragging, setDragging] = useState(false);
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

  // `md` is the dedicated profile control, where the hint and Remove belong.
  // `sm` sits inline in a member list, where the same chrome on every row is
  // noise -- there the circle alone does the job, and Remove stays available
  // on that member's own profile control.
  const showChrome = size === "md";

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

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (pending) return;

    const file = e.dataTransfer.files?.[0];
    if (!file) {
      // Dragging a picture from another tab hands over a URL, not a file.
      setError("Drop an image file saved on your device.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("That isn't an image. Drop a PNG or JPEG.");
      return;
    }
    void onPick(file);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            // Without preventDefault the browser opens the file instead.
            e.preventDefault();
            if (!pending) setDragging(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!pending) setDragging(true);
          }}
          onDragLeave={(e) => {
            // Moving across a child fires dragleave on the parent too; only
            // clear when the pointer has actually left the circle.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={onDrop}
          aria-label={hasPhoto ? "Change profile photo" : "Add a profile photo"}
          title="Click, or drop an image here"
          className={`${SIZE_CLASS[size]} group relative shrink-0 overflow-hidden rounded-full border transition disabled:opacity-60 ${
            dragging
              ? "border-gold-400 ring-2 ring-gold-400/50"
              : "border-line hover:border-gold-500/50"
          }`}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt={name ? `${name}'s photo` : "Profile photo"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-gold-500/20 font-medium text-gold-300">
              {avatarInitial(name)}
            </span>
          )}

          {/* Says what the circle does, without adding another control. */}
          <span
            className={`absolute inset-0 flex items-center justify-center bg-surface-0/75 text-[10px] font-medium text-fg-primary transition ${
              pending || dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {pending ? "…" : dragging ? "Drop" : hasPhoto ? "Change" : "Add"}
          </span>
        </button>

        {showChrome ? (
          <div className="flex flex-col items-start gap-0.5">
            <p className="text-xs text-fg-secondary">
              {pending ? "Uploading…" : "Click or drag an image here"}
            </p>
            {hasPhoto && allowRemove ? (
              <button
                type="button"
                disabled={pending}
                onClick={onRemove}
                className="text-[11px] text-fg-muted transition hover:text-status-danger disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}

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
