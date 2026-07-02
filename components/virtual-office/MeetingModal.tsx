"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function MeetingModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("office:start-meeting", handler);
    return () => window.removeEventListener("office:start-meeting", handler);
  }, []);

  if (!mounted || !open) return null;

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

        {/* Heading */}
        <h2 className="mb-6 text-xl font-semibold text-amber-400 tracking-wide">
          Start Meeting
        </h2>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => {
              window.open("https://zoom.us/start", "_blank", "noopener,noreferrer");
              setOpen(false);
            }}
            className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200 hover:border-amber-400/50 hover:bg-slate-700 transition-colors"
          >
            <span className="text-base">📹</span>
            Zoom
          </button>

          <button
            className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-400 transition-colors cursor-not-allowed opacity-60"
            disabled
          >
            <span className="text-base">🎥</span>
            Google Meet
            <span className="ml-auto text-xs text-slate-600">soon</span>
          </button>

          <button
            className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-400 transition-colors cursor-not-allowed opacity-60"
            disabled
          >
            <span className="text-base">🔗</span>
            Copy Link
            <span className="ml-auto text-xs text-slate-600">soon</span>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
