"use client";

// The Virtual Office experience (reboot). A SoWork-style spatial workspace:
// a 2D-canvas floor with hub rooms, the AI agents seated at their desks, and
// live human co-presence over Supabase Realtime. Move with WASD / arrows or
// click-to-move; walk near a teammate to open a "Spatial Meeting" range.
//
// This pass is presence-only — status, proximity, and emotes are live; audio /
// video is a later layer. Rendering is native Canvas 2D (no Phaser / Three).
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  TILE,
  SPAWN,
  agentDesks,
  clampToBounds,
} from "@/lib/office/layout";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  colorFromId,
  nearby,
  type Participant,
  type PresenceStatus,
} from "@/lib/office/presence";
import { drawOffice, type OfficeTheme } from "./render";

interface OfficeShellProps {
  userId: string;
  displayName: string;
  orgId: string | null;
  /** Whether Supabase Realtime is configured (co-presence enabled). */
  hasRealtime: boolean;
}

interface PresencePayload {
  name: string;
  x: number;
  y: number;
  color: string;
  status: PresenceStatus;
  emote: string | null;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  w: [0, -1],
  arrowdown: [0, 1],
  s: [0, 1],
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
};

const SPEED = 6.5; // tiles per second
const EMOTES = ["👋", "👍", "🎉", "☕", "💡", "🤝"];
const STATUSES: PresenceStatus[] = ["available", "focusing", "in_meeting", "away"];

function readTheme(el: HTMLElement): OfficeTheme {
  const cs = getComputedStyle(el);
  const triplet = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return (v || fallback).split(/\s+/).join(",");
  };
  const s0 = triplet("--fx-surface-0", "5 9 18");
  const s1 = triplet("--fx-surface-1", "10 17 31");
  const s2 = triplet("--fx-surface-2", "16 27 46");
  const s3 = triplet("--fx-surface-3", "24 40 66");
  return {
    surface0: `rgb(${s0})`,
    surface1: `rgb(${s1})`,
    surface2: `rgb(${s2})`,
    surface3: `rgb(${s3})`,
    grid: `rgba(${s3},0.4)`,
    fg: cs.color || "#e5edf7",
    fgMuted: "rgba(148,163,184,0.85)",
  };
}

// Deterministic agent roster — everyone renders these identically, so agents
// need no presence sync. Status is derived from the hub for a little life.
function useAgentParticipants(): Participant[] {
  return useMemo(() => {
    return agentDesks().map((desk): Participant => {
      const gated = desk.room.approvalGated;
      return {
        id: `agent:${desk.agent.key}`,
        name: desk.agent.name,
        kind: "agent",
        x: desk.x,
        y: desk.y,
        color: desk.agent.color,
        status: gated ? "focusing" : "available",
        agentKey: desk.agent.key,
        role: desk.agent.role,
        emote: null,
      };
    });
  }, []);
}

export function OfficeShell({ userId, displayName, orgId, hasRealtime }: OfficeShellProps) {
  const agents = useAgentParticipants();
  const myColor = useMemo(() => colorFromId(userId), [userId]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Live movement state lives in refs so the animation loop never re-renders.
  const posRef = useRef({ ...SPAWN });
  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const statusRef = useRef<PresenceStatus>("available");
  const emoteRef = useRef<string | null>(null);
  const themeRef = useRef<OfficeTheme | null>(null);
  const remotesRef = useRef<Map<string, Participant>>(new Map());
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const subscribedRef = useRef(false);
  const lastTrackRef = useRef(0);

  // Mirrored into React state only for the side panel (low-frequency updates).
  const [status, setStatus] = useState<PresenceStatus>("available");
  const [remotes, setRemotes] = useState<Participant[]>([]);
  const [nearbyList, setNearbyList] = useState<Participant[]>([]);

  const buildPayload = useCallback(
    (): PresencePayload => ({
      name: displayName,
      x: Number(posRef.current.x.toFixed(2)),
      y: Number(posRef.current.y.toFixed(2)),
      color: myColor,
      status: statusRef.current,
      emote: emoteRef.current,
    }),
    [displayName, myColor],
  );

  const track = useCallback(() => {
    if (subscribedRef.current && channelRef.current) {
      void channelRef.current.track(buildPayload());
    }
  }, [buildPayload]);

  // --- Supabase Realtime presence -----------------------------------------
  useEffect(() => {
    if (!hasRealtime || !orgId) return;
    const supabase = createClient();
    const channel = supabase.channel(`office:${orgId}`, {
      config: { presence: { key: userId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresencePayload>();
      const map = new Map<string, Participant>();
      for (const key of Object.keys(state)) {
        if (key === userId) continue;
        const meta = state[key]?.[0];
        if (!meta) continue;
        map.set(key, {
          id: key,
          name: meta.name || "Teammate",
          kind: "human",
          x: meta.x,
          y: meta.y,
          color: meta.color || "#6366f1",
          status: meta.status || "available",
          emote: meta.emote ?? null,
        });
      }
      remotesRef.current = map;
      setRemotes([...map.values()]);
    });

    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        subscribedRef.current = true;
        void channel.track(buildPayload());
      }
    });
    channelRef.current = channel;

    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [hasRealtime, orgId, userId, buildPayload]);

  // --- Input ---------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k in MOVE_KEYS) {
        keysRef.current.add(k);
        targetRef.current = null; // keyboard overrides click-to-move
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const onCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / OFFICE_WIDTH;
    const tx = (e.clientX - rect.left) / scale / TILE;
    const ty = (e.clientY - rect.top) / scale / TILE;
    targetRef.current = clampToBounds(tx, ty);
  }, []);

  // --- Animation + render loop --------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = OFFICE_WIDTH;
    canvas.height = OFFICE_HEIGHT;
    themeRef.current = readTheme(wrap);

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Integrate movement
      let dx = 0;
      let dy = 0;
      for (const k of keysRef.current) {
        const v = MOVE_KEYS[k];
        if (v) {
          dx += v[0];
          dy += v[1];
        }
      }
      const pos = posRef.current;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        const next = clampToBounds(
          pos.x + (dx / len) * SPEED * dt,
          pos.y + (dy / len) * SPEED * dt,
        );
        pos.x = next.x;
        pos.y = next.y;
      } else if (targetRef.current) {
        const t = targetRef.current;
        const ddx = t.x - pos.x;
        const ddy = t.y - pos.y;
        const dist = Math.hypot(ddx, ddy);
        if (dist < 0.12) {
          targetRef.current = null;
        } else {
          const step = Math.min(SPEED * dt, dist);
          pos.x += (ddx / dist) * step;
          pos.y += (ddy / dist) * step;
        }
      }

      // Throttled presence broadcast (~11/s) when we have moved
      if (now - lastTrackRef.current > 90) {
        lastTrackRef.current = now;
        track();
      }

      const local: Participant = {
        id: userId,
        name: displayName,
        kind: "human",
        x: pos.x,
        y: pos.y,
        color: myColor,
        status: statusRef.current,
        emote: emoteRef.current,
      };
      const participants = [...agents, ...remotesRef.current.values(), local];

      if (themeRef.current) {
        drawOffice({
          ctx,
          theme: themeRef.current,
          desks: agentDesks(),
          participants,
          localId: userId,
          time: now,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onTheme = () => {
      if (wrapRef.current) themeRef.current = readTheme(wrapRef.current);
    };
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", onTheme);

    return () => {
      cancelAnimationFrame(raf);
      mql.removeEventListener("change", onTheme);
    };
  }, [agents, userId, displayName, myColor, track]);

  // Recompute "near you" for the panel a few times a second.
  useEffect(() => {
    const id = setInterval(() => {
      const others = [...agents, ...remotesRef.current.values()];
      setNearbyList(nearby(posRef.current, others));
    }, 300);
    return () => clearInterval(id);
  }, [agents]);

  const changeStatus = useCallback(
    (s: PresenceStatus) => {
      statusRef.current = s;
      setStatus(s);
      track();
    },
    [track],
  );

  const sendEmote = useCallback(
    (glyph: string) => {
      emoteRef.current = glyph;
      track();
      setTimeout(() => {
        if (emoteRef.current === glyph) {
          emoteRef.current = null;
          track();
        }
      }, 3000);
    },
    [track],
  );

  const humanCount = remotes.length + 1;

  return (
    <div ref={wrapRef} className="fx-ambient">
      <header className="mb-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Virtual Office
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Your team, in one room
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          A spatial workspace where your executive agents work at their desks and
          teammates gather in real time. Move with{" "}
          <kbd className="rounded bg-surface-2 px-1 font-mono text-xs">WASD</kbd>{" "}
          or click to walk over — step inside someone&apos;s ring to start a
          spatial conversation.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        {/* Floor */}
        <div className="overflow-hidden rounded-xl border border-surface-3/60 bg-surface-1 shadow-lg">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            className="block w-full cursor-pointer"
            style={{ aspectRatio: `${OFFICE_WIDTH} / ${OFFICE_HEIGHT}` }}
            aria-label="Virtual office floor plan"
          />
        </div>

        {/* Side panel */}
        <aside className="flex flex-col gap-4">
          {!hasRealtime && (
            <div className="rounded-lg border border-gold-400/30 bg-gold-400/5 p-3 text-xs text-fg-secondary">
              Live co-presence needs Supabase Realtime configured. You&apos;re in
              solo mode — your agents are here, teammates will appear once it&apos;s
              connected.
            </div>
          )}

          {/* Your status */}
          <section>
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              Your status
            </h2>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeStatus(s)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition ${
                    status === s
                      ? "border-gold-400/60 bg-gold-400/10 text-fg-primary"
                      : "border-surface-3/50 text-fg-secondary hover:bg-surface-2"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: STATUS_COLORS[s] }}
                  />
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </section>

          {/* Emotes */}
          <section>
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              React
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {EMOTES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => sendEmote(g)}
                  className="rounded-md border border-surface-3/50 px-2.5 py-1 text-base transition hover:bg-surface-2"
                  aria-label={`React ${g}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </section>

          {/* Near you */}
          <section>
            <h2 className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              <span>Near you</span>
              <span className="text-gold-400">{nearbyList.length}</span>
            </h2>
            {nearbyList.length === 0 ? (
              <p className="text-xs text-fg-muted">
                Walk up to an agent or teammate to connect.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {nearbyList.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 rounded-md bg-surface-2/60 px-2 py-1.5"
                  >
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-surface-0"
                      style={{ background: p.color }}
                    >
                      {p.name[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-fg-primary">
                        {p.name}
                      </span>
                      <span className="block truncate text-[10px] text-fg-muted">
                        {p.kind === "agent" ? p.role : STATUS_LABELS[p.status]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* In the office */}
          <section>
            <h2 className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              <span>In the office</span>
              <span className="text-gold-400">
                {humanCount} · {agents.length} agents
              </span>
            </h2>
            <ul className="flex flex-col gap-1">
              <li className="flex items-center gap-2 text-xs text-fg-secondary">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: STATUS_COLORS[status] }}
                />
                {displayName} <span className="text-fg-muted">(you)</span>
              </li>
              {remotes.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 text-xs text-fg-secondary"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: STATUS_COLORS[p.status] }}
                  />
                  {p.name}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
