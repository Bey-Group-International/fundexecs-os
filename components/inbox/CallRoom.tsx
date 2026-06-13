'use client';

import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Info, Loader2, Radio, Sparkles, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { finalize_inbox_call } from '@/lib/actions/calls';

/* The in-app call surface (P4). The server mints a LiveKit join token + URL for
 * this room; <LiveCall> embeds the real-time media client (grid + mic/cam).
 * Recording/egress is intentionally deferred — the transcript stays client-
 * supplied in the wrap-up box (hence the transcription-consent banner), and the
 * 4-agent Meeting Copilot synthesizes it onto the linked deal. */

// Browser-only LiveKit client — never server-render it (livekit-client touches
// window/navigator at module scope).
const LiveCall = dynamic(() => import('./LiveCall'), {
  ssr: false,
  loading: () => (
    <Card className="flex items-center justify-center border-dashed p-8 text-fg-4">
      <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden />
      <span className="ml-2 text-[12.5px]">Connecting to the room…</span>
    </Card>
  )
});

export function CallRoom({ room, token, url }: { room: string; token: string; url: string }) {
  const router = useRouter();
  const [transcript, setTranscript] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function finalize() {
    setFinalizing(true);
    setError(null);
    try {
      const res = await finalize_inbox_call(room, transcript);
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not finalize the call — try again.');
      }
    } catch {
      setError('Could not finalize the call — check your connection and try again.');
    } finally {
      setFinalizing(false);
    }
  }

  if (done) {
    return (
      <Card className="p-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Sparkles size={20} strokeWidth={1.9} aria-hidden />
        </span>
        <h1 className="mt-3 text-[16px] font-semibold text-fg-1">Call wrapped</h1>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
          The room is closed and Earn’s team is synthesizing the transcript. Findings land on the
          linked deal as they complete.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Radio size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Live call</h1>
          <p className="mt-0.5 truncate text-[12.5px] text-fg-3">
            Room <span className="font-mono text-[11.5px] text-fg-4">{room}</span> · connected to{' '}
            {new URL(url).host}
          </p>
        </div>
      </Card>

      {/* Transcription-consent notice: no server recording happens, but the
          wrap-up transcript feeds Meeting Copilot — make that explicit to all
          participants before the call runs. */}
      <div className="flex items-start gap-2 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-fg-4">
        <Info size={14} className="mt-0.5 flex-none text-fg-5" aria-hidden />
        <span>
          This call isn’t recorded. A transcript you add at wrap-up is sent to Earn’s Meeting
          Copilot to write findings onto the linked deal — let participants know they’re being
          transcribed.
        </span>
      </div>

      <LiveCall token={token} serverUrl={url} onLeave={() => router.refresh()} />

      <Card className="flex flex-col gap-2 p-5">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-fg-2">
          <Sparkles size={13} strokeWidth={1.9} className="text-[var(--accent)]" aria-hidden />
          Wrap up — Meeting Copilot
        </div>
        <p className="text-[12px] text-fg-4">
          Paste the call transcript. The 4-agent team scores commitment and writes an operator-ready
          brief onto the deal.
        </p>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={8}
          disabled={finalizing}
          placeholder="Paste the call transcript…"
          className="w-full resize-y rounded-lg border border-hairline bg-bg-0 px-3 py-2 text-[12.5px] leading-relaxed text-fg-1 outline-none focus:border-[var(--accent-line)] disabled:opacity-60"
        />
        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={15} aria-hidden />
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void finalize()}
            disabled={finalizing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {finalizing ? (
              <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
            ) : (
              <Sparkles size={13} strokeWidth={1.9} aria-hidden />
            )}
            End call &amp; summarize
          </button>
        </div>
      </Card>
    </div>
  );
}
