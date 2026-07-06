"use client";

import { useEffect, useRef } from "react";

type VideoTile = {
  peerId: string;
  label: string;
  el: HTMLVideoElement;
};

type VideoTileBarProps = {
  tiles: VideoTile[];
  localStream: MediaStream | null;
  localLabel: string;
  /** Per-peer proximity (0..1) — nearer avatars render more prominently. */
  proximity?: Record<string, number>;
};

function RemoteTile({ tile, proximity = 1 }: { tile: VideoTile; proximity?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = tile.el.srcObject;
    }
  }, [tile.el]);

  return (
    <div
      className="flex shrink-0 flex-col items-center gap-0.5 transition-all duration-200"
      style={{ opacity: proximity, transform: `scale(${0.9 + proximity * 0.1})`, transformOrigin: "bottom center" }}
      title={proximity < 0.5 ? `${tile.label} — far` : tile.label}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="w-[120px] h-[90px] rounded-lg object-cover bg-slate-800 border"
        style={{ borderColor: `rgba(148,163,184,${0.25 + proximity * 0.45})` }}
      />
      <span className="text-[9px] text-slate-400 truncate max-w-[120px]">{tile.label}</span>
    </div>
  );
}

function LocalTile({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="w-[120px] h-[90px] rounded-lg object-cover bg-slate-800 border border-emerald-500/40"
      />
      <span className="text-[9px] text-emerald-400 truncate max-w-[120px]">{label} (you)</span>
    </div>
  );
}

export function VideoTileBar({ tiles, localStream, localLabel, proximity }: VideoTileBarProps) {
  if (!localStream && tiles.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 py-2 bg-slate-900/90 border-b border-slate-800 overflow-x-auto">
      {localStream && <LocalTile stream={localStream} label={localLabel} />}
      {tiles.map((t) => (
        <RemoteTile key={t.peerId} tile={t} proximity={proximity?.[t.peerId]} />
      ))}
    </div>
  );
}
