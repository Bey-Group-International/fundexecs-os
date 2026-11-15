"use client";

// Live captions over the stage: the last couple of spoken lines with the
// speaker's name, fading a few seconds after the talking stops. Per viewer
// (the toggle lives in the room, not on the server), and never shown while the
// host has paused the notetaker, since nothing is then being transcribed.

import { useMemo } from "react";

export interface CaptionLine {
  id: string;
  speakerId: string;
  speaker: string;
  text: string;
  ts: number;
  isLocal: boolean;
}

/** A caption is dropped this long after it was spoken. */
export const CAPTION_TTL_MS = 6000;
/** At most this many speaker turns are on screen at once. */
export const CAPTION_MAX_TURNS = 2;

/** The turns to show now: recent lines, one per run of the same speaker, newest last. */
export function captionTurns(lines: readonly CaptionLine[], now: number): Array<{ key: string; speaker: string; text: string }> {
  const out: Array<{ key: string; speakerId: string; speaker: string; text: string }> = [];
  for (const l of lines) {
    if (now - l.ts > CAPTION_TTL_MS || !l.text.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && prev.speakerId === l.speakerId) prev.text = `${prev.text} ${l.text.trim()}`;
    else out.push({ key: l.id, speakerId: l.speakerId, speaker: l.isLocal ? "You" : l.speaker, text: l.text.trim() });
  }
  return out.slice(-CAPTION_MAX_TURNS).map(({ speakerId: _s, ...rest }) => ({ ...rest, text: rest.text.slice(-220) }));
}

export function CaptionStrip({ lines, now }: { lines: readonly CaptionLine[]; now: number }) {
  const turns = useMemo(() => captionTurns(lines.slice(-12), now), [lines, now]);
  if (!turns.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex flex-col items-center gap-1 px-4" aria-live="polite" data-captions>
      {turns.map((t) => (
        <p key={t.key} className="max-w-2xl rounded-lg bg-black/70 px-3 py-1.5 text-center text-sm text-white">
          <span className="mr-2 font-medium text-[var(--gold-400)]">{t.speaker}</span>
          {t.text}
        </p>
      ))}
    </div>
  );
}
