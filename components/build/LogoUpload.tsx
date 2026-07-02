"use client";

import { useRef, useState } from "react";
import { resizeLogo } from "./logo-resize";

export function LogoUpload({
  name = "logo_url",
  defaultValue = "",
}: {
  name?: string;
  defaultValue?: string;
}) {
  const [preview, setPreview] = useState(defaultValue);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  function commitValue(v: string) {
    setPreview(v);
    if (hiddenRef.current) {
      hiddenRef.current.value = v;
      // Bubble a change event so AutosaveForm's debounce picks it up.
      hiddenRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  async function onFile(file: File) {
    setError("");
    const result = await resizeLogo(file);
    if ("error" in result) {
      setError(result.error);
    } else {
      commitValue(result.dataUrl);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Logo preview"
            className="h-12 w-12 rounded-lg object-contain border border-line bg-surface-1 shrink-0 p-1"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-surface-1 font-mono text-[10px] text-fg-muted">
            logo
          </span>
        )}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
          >
            {preview ? "Change logo" : "Upload logo"}
          </button>
          {preview && (
            <button
              type="button"
              onClick={() => {
                commitValue("");
                setError("");
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="text-left text-[11px] text-fg-muted transition hover:text-status-danger"
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </div>
      {error && <p className="text-xs text-status-danger">{error}</p>}
      {/* Uncontrolled hidden input — value updated imperatively in commitValue */}
      <input ref={hiddenRef} type="hidden" name={name} defaultValue={defaultValue} />
    </div>
  );
}
