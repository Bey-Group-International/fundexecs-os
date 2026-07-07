"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { RichText } from "@/components/RichText";
import { text } from "@/lib/richtext";

// Adventure-style rich text: a gold gradient title, built as a component tree.
const MEETING_TITLE = text("Start Meeting")
  .gradient(["#fde68a", "#fbbf24", "#c9a84c"])
  .build();

/**
 * The Executive Floor "Start Meeting" modal. Fully native: starting a meeting
 * creates an in-app WebRTC room (POST /api/meetings/create) and drops you into
 * it at /meetings/{roomCode} — no Zoom or Google Meet dependency. "Browse
 * meetings" opens the native lobby (join by code, schedule, past meetings).
 */
export function MeetingModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handler = () => {
      setError(null);
      setOpen(true);
    };
    window.addEventListener("office:start-meeting", handler);
    return () => window.removeEventListener("office:start-meeting", handler);
  }, []);

  if (!mounted || !open) return null;

  const startMeeting = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/meetings/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Executive Floor meeting" }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to start meeting");
        }
        const data = (await res.json()) as { roomCode: string };
        setOpen(false);
        router.push(`/meetings/${data.roomCode}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start meeting");
      }
    });
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Heading — rendered from an Adventure-style rich-text component. */}
        <h2 className="mb-1 text-xl font-semibold tracking-wide">
          <RichText component={MEETING_TITLE} />
        </h2>
        <p className="mb-6 text-[13px] text-slate-400">
          Native in-app video with live transcription — no external apps.
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={startMeeting}
            disabled={isPending}
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            style={{ color: "#0a0806", background: "#c9a84c" }}
          >
            <span className="text-base">🎥</span>
            {isPending ? "Starting…" : "Start meeting"}
          </button>

          <button
            onClick={() => {
              setOpen(false);
              router.push("/meetings");
            }}
            className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200 hover:border-amber-400/50 hover:bg-slate-700 transition-colors"
          >
            <span className="text-base">📋</span>
            Browse meetings — join or schedule
          </button>

          {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
