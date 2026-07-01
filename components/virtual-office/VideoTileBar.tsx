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
};

function RemoteTile({ tile }: { tile: VideoTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = tile.el.srcObject;
    }
  }, [tile.el]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="w-[120px] h-[90px] rounded-lg object-cover bg-slate-800 border border-slate-700"
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

export function VideoTileBar({ tiles, localStream, localLabel }: VideoTileBarProps) {
  if (!localStream && tiles.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 py-2 bg-slate-900/90 border-b border-slate-800 overflow-x-auto">
      {localStream && <LocalTile stream={localStream} label={localLabel} />}
      {tiles.map((t) => (
        <RemoteTile key={t.peerId} tile={t} />
      ))}
    </div>
  );
}
