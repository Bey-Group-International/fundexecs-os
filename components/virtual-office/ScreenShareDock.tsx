"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Floating "workspace share" dock — a live self-view of the screen/window the
 * operator is currently sharing to the floor, pinned over the office canvas.
 * "Pop out" hands the stream to the browser's native Picture-in-Picture so the
 * shared workspace stays visible while the operator works in another tab.
 *
 * Slice 1 is the local capture + PiP surface (reuses the meetings
 * getDisplayMedia pattern); broadcasting the screen track to the proximity
 * bubble is a follow-up that plugs the same stream into the RTC mesh.
 */
export function ScreenShareDock({ stream, onStop }: { stream: MediaStream; onStop: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pipActive, setPipActive] = useState(false);
  const pipSupported = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.srcObject = stream;
  }, [stream]);

  // Keep local UI in sync when PiP is closed from the browser's own controls.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const enter = () => setPipActive(true);
    const leave = () => setPipActive(false);
    v.addEventListener("enterpictureinpicture", enter);
    v.addEventListener("leavepictureinpicture", leave);
    return () => {
      v.removeEventListener("enterpictureinpicture", enter);
      v.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v || !pipSupported) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      // PiP denied or unsupported for this stream — no-op
    }
  };

  return (
    <div
      className="pointer-events-auto absolute bottom-3 right-3 z-20 w-[248px] overflow-hidden rounded-xl border shadow-lg backdrop-blur-sm"
      style={{
        background: "rgba(10,8,6,0.9)",
        borderColor: "rgba(201,168,76,0.35)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ borderBottom: "1px solid rgba(201,168,76,0.18)" }}>
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} />
          Sharing your workspace
        </span>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="block w-full bg-black object-contain"
        style={{ aspectRatio: "16 / 9" }}
      />
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        {pipSupported ? (
          <button
            type="button"
            onClick={togglePip}
            className="rounded-md px-2 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors"
            style={{ color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)", background: "rgba(201,168,76,0.08)" }}
          >
            {pipActive ? "Dock back" : "Pop out"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onStop}
          className="ml-auto rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors"
          style={{ color: "#0a0806", background: "#c9a84c" }}
        >
          Stop sharing
        </button>
      </div>
    </div>
  );
}
