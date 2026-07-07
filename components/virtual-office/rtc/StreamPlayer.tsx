"use client";

/**
 * FundExecs OS — reusable WebRTC stream player + stats HUD.
 *
 * A thin, self-contained `<video>` wrapper for any inbound `MediaStream` (an
 * SFU downstream, a screen share, or a future cloud-render feed). Handles the
 * autoplay/mute dance and, when given a `getStats` source, overlays a live HUD
 * (bitrate · fps · loss) computed by the pure `streamStats` module.
 *
 * Decoupled from any specific peer connection: it takes a `MediaStream` to show
 * and, optionally, a `getStats` thunk (usually `() => pc.getStats()`), so it
 * works with the mesh manager, the SFU manager, or anything else.
 */

import { useEffect, useRef, useState } from "react";
import {
  computeStats,
  extractInboundSample,
  formatStats,
  type InboundSample,
  type StreamStats,
} from "./streamStats";

export type StreamPlayerProps = {
  stream: MediaStream | null;
  muted?: boolean;
  /** Show the live stats HUD (requires `getStats`). */
  showStats?: boolean;
  /** Stats source, typically `() => peerConnection.getStats()`. */
  getStats?: () => Promise<Iterable<Record<string, unknown>>>;
  /** HUD refresh interval in ms (default 1000). */
  statsIntervalMs?: number;
  className?: string;
};

export function StreamPlayer({
  stream,
  muted = true,
  showStats = false,
  getStats,
  statsIntervalMs = 1000,
  className,
}: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);

  // Bind the stream to the element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {}); // autoplay may be blocked until a gesture
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // Poll stats while requested.
  useEffect(() => {
    if (!showStats || !getStats || !stream) {
      setStats(null);
      return;
    }
    let prev: InboundSample | null = null;
    let cancelled = false;
    const tick = async () => {
      try {
        const report = await getStats();
        if (cancelled) return;
        const sample = extractInboundSample(report as Iterable<Record<string, unknown>>, Date.now());
        if (sample) {
          if (prev) setStats(computeStats(prev, sample));
          prev = sample;
        }
      } catch {
        // getStats can reject during teardown; ignore and keep polling.
      }
    };
    const id = setInterval(tick, statsIntervalMs);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showStats, getStats, stream, statsIntervalMs]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {showStats && stats ? (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            padding: "3px 8px",
            borderRadius: 6,
            font: "500 11px/1.4 ui-monospace, monospace",
            color: "#e8eef5",
            background: "rgba(9,12,20,0.7)",
            pointerEvents: "none",
          }}
        >
          {formatStats(stats)}
        </div>
      ) : null}
    </div>
  );
}
