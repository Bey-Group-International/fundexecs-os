"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { virtualOfficeRoutes } from "@/lib/virtualOfficeRoutes";
import { type UserAvatar, userAvatarSpec } from "@/lib/office/userAvatar";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";
import { saveOfficeAvatar } from "@/app/(app)/settings/actions";
import { onDeviceAvatarProvider } from "@/lib/office/avatarGenerator/onDeviceProvider";
import type {
  AvatarImageInput,
  AvatarGenerationResult,
  GeneratedAvatarProfile,
  AvatarJobState,
} from "@/lib/office/avatarGenerator/types";

const GOLD = "#c9a84c";

const STAGE_LABEL: Record<AvatarJobState, string> = {
  idle: "",
  consent: "",
  upload: "",
  validating: "Checking your photo…",
  analyzing: "Reading tones on your device…",
  generating: "Composing avatar options…",
  ready: "",
  failed: "",
};

/**
 * Create-from-photo — turns a portrait into editable 2.5D avatar options,
 * entirely on the device. Consent gate → upload → on-device validate/analyze/
 * generate → pick a variation → save. The source image is never uploaded; the
 * user can delete it at any point (and optionally auto-delete after generation).
 */
export function PhotoAvatarGenerator({ base }: { base: UserAvatar }) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(true);
  const [job, setJob] = useState<AvatarJobState>("consent");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AvatarGenerationResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(false);
  const [sourceDeleted, setSourceDeleted] = useState(false);

  const inputRef = useRef<AvatarImageInput | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const profiles: GeneratedAvatarProfile[] = result ? [result.primary, ...result.alternatives] : [];
  const selected = profiles.find((p) => p.id === selectedId) ?? result?.primary ?? null;

  const cleanupSource = useCallback(async () => {
    if (inputRef.current) {
      await onDeviceAvatarProvider.deleteSourceImage(inputRef.current);
      inputRef.current = null;
    }
    setSourceDeleted(true);
  }, []);

  const runPipeline = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      setPublished(false);
      setSourceDeleted(false);
      const previewUrl = URL.createObjectURL(file);
      const input: AvatarImageInput = { file, previewUrl };
      inputRef.current = input;
      try {
        setJob("validating");
        const valid = await onDeviceAvatarProvider.validateImage(input);
        if (!valid.ok) {
          setError(valid.message);
          setJob("failed");
          return;
        }
        setJob("analyzing");
        const analysis = await onDeviceAvatarProvider.analyzeImage(input);
        setJob("generating");
        const gen = await onDeviceAvatarProvider.generateAvatar({ analysis, base, variations: 2 });
        setResult(gen);
        setSelectedId(gen.primary.id);
        setJob("ready");
        if (deleteAfter) await cleanupSource();
      } catch {
        setError("Something went wrong reading that image. Please try another photo.");
        setJob("failed");
      }
    },
    [base, deleteAfter, cleanupSource],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void runPipeline(file);
    e.target.value = ""; // allow re-selecting the same file
  };

  const startOver = async () => {
    await cleanupSource();
    setResult(null);
    setSelectedId(null);
    setError(null);
    setPublished(false);
    setJob("upload");
  };

  const save = async (thenStudio: boolean) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveOfficeAvatar(selected.avatar);
      if (res?.error) {
        setError(res.error);
      } else {
        await cleanupSource();
        if (thenStudio) {
          router.push(virtualOfficeRoutes.characterStudio);
        } else {
          setPublished(true);
        }
      }
    } catch {
      setError("Couldn't save — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-line/60 bg-[#0a0c11] p-5 text-slate-200">
      <div className="mb-4 flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Character Studio</div>
          <h1 className="text-[17px] font-semibold text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
            Create from photo
          </h1>
        </div>
        <Link
          href={virtualOfficeRoutes.characterStudio}
          className="ml-auto rounded-md border px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:text-white"
          style={{ borderColor: "rgba(255,255,255,0.14)" }}
        >
          Manual studio
        </Link>
      </div>

      {/* Consent gate */}
      {job === "consent" && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4 text-[13px] leading-relaxed text-slate-300" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <p className="mb-2 font-semibold text-slate-100">Your photo stays on your device.</p>
            <ul className="ml-4 list-disc space-y-1 text-slate-400">
              <li>The image is processed entirely in your browser — it is never uploaded or stored on our servers.</li>
              <li>We read only the tones needed to build an avatar (skin and hair). No sensitive characteristics are inferred or kept.</li>
              <li>Everything generated is fully editable, and you can delete the photo at any time.</li>
            </ul>
          </div>
          <label className="flex items-start gap-2 text-[13px] text-slate-300">
            <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} className="mt-0.5" />
            <span>I consent to processing this photo on my device to generate an avatar.</span>
          </label>
          <label className="flex items-start gap-2 text-[12px] text-slate-400">
            <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} className="mt-0.5" />
            <span>Delete my original photo after avatar generation.</span>
          </label>
          <div className="flex justify-end gap-2">
            <Link
              href={virtualOfficeRoutes.characterStudio}
              className="rounded-md border px-3 py-1.5 text-[12px] text-slate-300"
              style={{ borderColor: "rgba(255,255,255,0.14)" }}
            >
              Cancel
            </Link>
            <button
              type="button"
              disabled={!consented}
              onClick={() => setJob("upload")}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider transition-opacity disabled:opacity-40"
              style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Upload */}
      {job === "upload" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-12 transition-colors hover:border-[#c9a84c66]"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            <span className="text-3xl" aria-hidden>⬆</span>
            <span className="text-[13px] text-slate-200">Choose a portrait or take a photo</span>
            <span className="text-[11px] text-slate-500">JPG, PNG, WebP or HEIC · head &amp; shoulders · neutral lighting</span>
          </button>
          <input ref={fileInput} type="file" accept="image/*" capture="user" className="hidden" onChange={onPick} />
          <ul className="ml-4 list-disc text-[11px] text-slate-500">
            <li>Face the camera, one person, unobstructed.</li>
            <li>Avoid heavy filters, sunglasses, and extreme angles.</li>
          </ul>
        </div>
      )}

      {/* Processing */}
      {(job === "validating" || job === "analyzing" || job === "generating") && (
        <div className="flex flex-col items-center justify-center gap-3 py-14">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15" style={{ borderTopColor: GOLD }} />
          <p className="text-[13px] text-slate-300">{STAGE_LABEL[job]}</p>
          <p className="text-[11px] text-slate-500">Processing on your device — nothing is uploaded.</p>
        </div>
      )}

      {/* Error */}
      {job === "failed" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-[13px] text-red-300">
            {error ?? "That photo couldn't be used."}
          </div>
          <button
            type="button"
            onClick={startOver}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider"
            style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
          >
            Try another photo
          </button>
        </div>
      )}

      {/* Ready — variations */}
      {job === "ready" && result && !published && (
        <div className="space-y-4">
          <p className="text-[12px] text-slate-400">
            Pick a starting look — you can refine every detail afterward. Tones were matched from your photo on this device.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {profiles.map((p) => {
              const active = p.id === (selectedId ?? result.primary.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className="flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors"
                  style={{
                    borderColor: active ? `${GOLD}90` : "rgba(255,255,255,0.1)",
                    background: active ? `${GOLD}12` : "rgba(255,255,255,0.02)",
                  }}
                >
                  <AvatarPreview spec={userAvatarSpec(p.avatar)} size={104} />
                  <span className="text-[11px]" style={{ color: active ? GOLD : "#cbd2dc", fontFamily: "Georgia, serif" }}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
            <button
              type="button"
              onClick={cleanupSource}
              disabled={sourceDeleted}
              className="rounded-md border px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-40"
              style={{ borderColor: "rgba(255,255,255,0.14)" }}
            >
              {sourceDeleted ? "Photo deleted ✓" : "Delete original photo"}
            </button>
            <button
              type="button"
              onClick={startOver}
              className="rounded-md border px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:text-slate-200"
              style={{ borderColor: "rgba(255,255,255,0.14)" }}
            >
              Start over
            </button>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => save(true)}
                disabled={saving}
                className="rounded-md border px-3 py-1.5 text-[11px] uppercase tracking-wider transition-colors disabled:opacity-40"
                style={{ borderColor: `${GOLD}66`, color: GOLD }}
              >
                {saving ? "Saving…" : "Save & refine in Studio"}
              </button>
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving}
                className="rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-opacity disabled:opacity-40"
                style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
              >
                {saving ? "Publishing…" : "Publish avatar"}
              </button>
            </div>
          </div>
          {error && <p className="text-[12px] text-red-300">{error}</p>}
        </div>
      )}

      {/* Published confirmation */}
      {published && selected && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <AvatarPreview spec={userAvatarSpec(selected.avatar)} size={140} />
          <div>
            <p className="text-[15px] font-semibold text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
              Your avatar is live
            </p>
            <p className="text-[12px] text-slate-400">It now represents you across the Virtual Office.</p>
          </div>
          <div className="flex gap-2">
            <Link
              href={virtualOfficeRoutes.characterStudio}
              className="rounded-md border px-3 py-1.5 text-[12px] text-slate-300"
              style={{ borderColor: "rgba(255,255,255,0.14)" }}
            >
              Refine in Studio
            </Link>
            <Link
              href={virtualOfficeRoutes.root}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider"
              style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
            >
              Enter office
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
