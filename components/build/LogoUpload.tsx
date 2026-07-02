"use client";

import { useRef, useState } from "react";

const MAX_LOGO_BYTES = 600 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function estimateBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

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
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const longest = Math.max(img.width, img.height);
      const scale = longest > 512 ? 512 / longest : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("Could not process this image. Try another file.");
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      let dataUrl = canvas.toDataURL("image/webp", 0.85);
      if (!dataUrl.startsWith("data:image/webp")) {
        dataUrl = canvas.toDataURL("image/png");
      }
      if (estimateBytes(dataUrl) > MAX_LOGO_BYTES) {
        setError("Image is too large after compression (>600KB). Try a smaller or simpler image.");
        return;
      }
      commitValue(dataUrl);
    } catch {
      setError("Could not read that file. Make sure it's a valid JPG or PNG.");
    } finally {
      URL.revokeObjectURL(url);
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
