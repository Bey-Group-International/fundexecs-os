"use client";

// The room behind the pre-join screen: who is in it already, and whether this
// connection is good enough for it. One request does both — the presence read
// is timed, and its round trips are the connection check — so the screen adds
// one light poll rather than two.

import { useCallback, useEffect, useRef, useState } from "react";
import { inRoomLine, type RoomSnapshot } from "@/lib/meetings/room-presence";
import { connectionVerdict, medianMs, type ConnectionVerdict } from "@/lib/meetings/connection-check";

/** How often the room is re-read while somebody sits on this screen. */
const POLL_MS = 15_000;
/** Round trips timed when the screen opens, or a re-check is asked for. */
const PROBES = 3;

type NavigatorWithConnection = Navigator & { connection?: { effectiveType?: string } };

export function usePreJoinRoom(roomCode: string, enabled = true) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [verdict, setVerdict] = useState<ConnectionVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const samples = useRef<number[]>([]);

  const read = useCallback(async (): Promise<number> => {
    const started = performance.now();
    try {
      const res = await fetch(`/api/meetings/public/${encodeURIComponent(roomCode)}/presence`, { cache: "no-store" });
      const took = performance.now() - started;
      if (res.ok) {
        const body = (await res.json()) as Partial<RoomSnapshot>;
        if (typeof body.count === "number") {
          setSnapshot({
            count: body.count,
            hostPresent: Boolean(body.hostPresent),
            startedAt: typeof body.startedAt === "string" ? body.startedAt : null,
            names: Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : [],
          });
        }
      }
      // Any answer is a round trip, a refusal included: it is the network
      // being timed, not the room.
      return took;
    } catch {
      return Number.NaN;
    }
  }, [roomCode]);

  const judge = useCallback(() => {
    const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    const type = typeof navigator === "undefined" ? null : (navigator as NavigatorWithConnection).connection?.effectiveType ?? null;
    setVerdict(connectionVerdict(medianMs(samples.current.slice(-PROBES)), online, type));
  }, []);

  const recheck = useCallback(async () => {
    setChecking(true);
    const fresh: number[] = [];
    for (let i = 0; i < PROBES; i++) fresh.push(await read());
    samples.current = fresh;
    judge();
    setChecking(false);
  }, [read, judge]);

  useEffect(() => {
    if (!enabled) return;
    void recheck();
    const tick = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void read().then((ms) => {
        samples.current = [...samples.current, ms].slice(-PROBES);
        judge();
      });
    }, POLL_MS);
    const onLine = () => judge();
    window.addEventListener("online", onLine);
    window.addEventListener("offline", onLine);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", onLine);
      window.removeEventListener("offline", onLine);
    };
  }, [enabled, recheck, read, judge]);

  return { snapshot, verdict, checking, recheck };
}

/** "Ana and Bo are in · started 12 min ago", with a live dot when anyone is. */
export function InRoomLine({ snapshot, now }: { snapshot: RoomSnapshot | null; now: number }) {
  if (!snapshot) return null;
  const busy = snapshot.count > 0;
  return (
    <p data-in-room="" className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-[var(--status-success)]" : "bg-[var(--fg-muted)]/50"}`}
      />
      <span className="min-w-0 truncate">{inRoomLine(snapshot, now)}</span>
    </p>
  );
}

const QUALITY_DOT: Record<ConnectionVerdict["quality"], string> = {
  good: "bg-[var(--status-success)]",
  fair: "bg-[var(--status-warning)]",
  poor: "bg-[var(--status-danger)]",
  offline: "bg-[var(--status-danger)]",
};

/** "Connection · Good (48 ms)", with what to do when it is not, and a re-check. */
export function ConnectionRow({
  verdict,
  checking,
  onRecheck,
}: {
  verdict: ConnectionVerdict | null;
  checking: boolean;
  onRecheck: () => void;
}) {
  return (
    <div data-connection={verdict?.quality ?? "checking"} className="flex flex-col gap-1 rounded-lg border border-[var(--line)] px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${verdict && !checking ? QUALITY_DOT[verdict.quality] : "animate-pulse bg-[var(--fg-muted)]/50"}`} />
        <span className="font-medium text-[var(--fg-secondary)]">Connection</span>
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-[var(--fg-muted)]">
          {checking || !verdict ? "Checking…" : verdict.label}
        </span>
        <button
          type="button"
          onClick={onRecheck}
          disabled={checking}
          className="min-h-9 shrink-0 px-1 text-[11px] text-[var(--gold-400)] hover:underline disabled:opacity-50 sm:min-h-0"
        >
          Check again
        </button>
      </div>
      {verdict?.advice && !checking ? <p className="text-[11px] leading-snug text-[var(--fg-muted)]">{verdict.advice}</p> : null}
    </div>
  );
}
