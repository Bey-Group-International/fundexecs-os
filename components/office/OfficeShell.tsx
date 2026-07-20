"use client";

// The Virtual Office experience (reboot). A SoWork-style spatial workspace:
// a 2D-canvas floor with hub rooms, the AI agents seated at their desks, and
// live human co-presence over Supabase Realtime. Move with WASD / arrows or
// click-to-move; walk near a teammate to open a proximity "Spatial Meeting"
// with real spatial voice/video.
//
// Composes the follow-up systems: a persisted, editable layout; live agent
// activity from real task data; proximity voice/video over a P2P mesh; and a
// demo mode + guided tour. Rendering is native Canvas 2D (no Phaser / Three).
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  TILE,
  SPAWN,
  agentDesks,
  clampToBounds,
  roomAt,
  type OfficeRoom,
} from "@/lib/office/layout";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  colorFromId,
  nearby,
  type Participant,
  type PresenceStatus,
} from "@/lib/office/presence";
import type { OfficeLayoutData } from "@/lib/office/layoutStore";
import type { AgentActivity } from "@/lib/office/activity";
import { demoParticipants } from "@/lib/office/demoParticipants";
import { recordPresenceEvent } from "@/lib/office/analyticsServer";
import { drawOffice, type OfficeTheme } from "./render";
import { useProximityVoice } from "./useProximityVoice";
import { OfficeMapEditor } from "./OfficeMapEditor";
import { RoomCallDock } from "./RoomCallDock";
import { OfficeChat } from "./OfficeChat";
import { OfficeTour, useOfficeTour } from "./OfficeTour";

interface OfficeShellProps {
  userId: string;
  displayName: string;
  orgId: string | null;
  /** Whether Supabase Realtime is configured (co-presence + voice enabled). */
  hasRealtime: boolean;
  /** Persisted (or default) office layout. */
  layout: OfficeLayoutData;
  /** Server-fetched agent activity, keyed by agent key. */
  initialActivity: Record<string, AgentActivity>;
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

function shorten(text: string, max = 42): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** A muted <video> sink that binds a MediaStream (audio is handled by the
 * voice hook's spatial audio elements, so every tile stays muted). */
function VideoTile({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);
  const hasVideo = stream.getVideoTracks().some((t) => t.readyState === "live");
  if (!hasVideo) return null;
  return (
    <div className="relative overflow-hidden rounded-md border border-surface-3/60 bg-surface-0">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="h-20 w-full object-cover"
      />
      <span className="absolute bottom-0 left-0 w-full truncate bg-black/50 px-1 py-0.5 text-[10px] text-white">
        {label}
      </span>
    </div>
  );
}

export function OfficeShell({
  userId,
  displayName,
  orgId,
  hasRealtime,
  layout,
  initialActivity,
}: OfficeShellProps) {
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

  // Editable layout + live agent activity, mirrored into refs for the loop.
  const [layoutState, setLayoutState] = useState<OfficeLayoutData>(layout);
  const desks = useMemo(() => agentDesks(layoutState.rooms), [layoutState.rooms]);
  const desksRef = useRef(desks);
  desksRef.current = desks;
  const roomsRef = useRef(layoutState.rooms);
  roomsRef.current = layoutState.rooms;
  const [activity, setActivity] = useState(initialActivity);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  // Mirrored into React state only for the side panel (low-frequency updates).
  const [status, setStatus] = useState<PresenceStatus>("available");
  const [remotes, setRemotes] = useState<Participant[]>([]);
  const [nearbyList, setNearbyList] = useState<Participant[]>([]);
  // Local tile + the room the local user currently stands in — drives the
  // meeting-room dock and the analytics room-enter/leave events.
  const [selfTile, setSelfTile] = useState({ x: SPAWN.x, y: SPAWN.y });
  const [currentRoom, setCurrentRoom] = useState<OfficeRoom | null>(null);
  const currentRoomRef = useRef<OfficeRoom | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const demoModeRef = useRef(false);
  demoModeRef.current = demoMode;
  const [editing, setEditing] = useState(false);
  const tour = useOfficeTour();

  // Proximity voice/video mesh (P2P), gated on Realtime being configured.
  const voice = useProximityVoice({
    enabled: hasRealtime && !!orgId,
    orgId: orgId ?? "",
    userId,
    displayName,
    getSelfPos: () => posRef.current,
    humans: remotes,
  });

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

  // --- Live agent activity over task_events --------------------------------
  useEffect(() => {
    if (!hasRealtime || !orgId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`office-activity:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_events",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const row = payload.new as {
            agent?: string | null;
            event_type?: string;
            payload?: { message?: string } | null;
          };
          const key = row.agent;
          if (!key) return;
          const done = row.event_type === "task.completed";
          const label = row.payload?.message;
          setActivity((prev) => ({
            ...prev,
            [key]: done
              ? { status: "available", label: "Wrapped up a task", busy: false }
              : {
                  status: "focusing",
                  label: shorten(label || "Working…"),
                  busy: true,
                },
          }));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hasRealtime, orgId]);

  // --- Input ---------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't hijack typing in the editor's inputs.
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
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

      // Throttled presence broadcast (~11/s)
      if (now - lastTrackRef.current > 90) {
        lastTrackRef.current = now;
        track();
      }

      // Agents, seated at desks, reflecting their live activity.
      const agentParticipants: Participant[] = desksRef.current.map((desk) => {
        const act = activityRef.current[desk.agent.key];
        return {
          id: `agent:${desk.agent.key}`,
          name: desk.agent.name,
          kind: "agent",
          x: desk.x,
          y: desk.y,
          color: desk.agent.color,
          status: act?.status ?? "available",
          agentKey: desk.agent.key,
          role: desk.agent.role,
          emote: null,
          activityLabel: act?.label,
          busy: act?.busy ?? false,
        };
      });

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

      const participants = [
        ...agentParticipants,
        ...remotesRef.current.values(),
        ...(demoModeRef.current ? demoParticipants(now) : []),
        local,
      ];

      if (themeRef.current) {
        drawOffice({
          ctx,
          theme: themeRef.current,
          rooms: roomsRef.current,
          desks: desksRef.current,
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
  }, [userId, displayName, myColor, track]);

  // Recompute "near you" for the panel a few times a second.
  useEffect(() => {
    const id = setInterval(() => {
      const agentsNow: Participant[] = desksRef.current.map((desk) => {
        const act = activityRef.current[desk.agent.key];
        return {
          id: `agent:${desk.agent.key}`,
          name: desk.agent.name,
          kind: "agent",
          x: desk.x,
          y: desk.y,
          color: desk.agent.color,
          status: act?.status ?? "available",
          role: desk.agent.role,
        };
      });
      const others = [
        ...agentsNow,
        ...remotesRef.current.values(),
        ...(demoModeRef.current ? demoParticipants(performance.now()) : []),
      ];
      const pos = posRef.current;
      setNearbyList(nearby(pos, others));
      setSelfTile({ x: pos.x, y: pos.y });

      // Track which room we're in; record enter/leave for analytics (the
      // server only persists these when the member has opted in).
      const room = roomAt(pos.x, pos.y);
      if ((room?.key ?? null) !== (currentRoomRef.current?.key ?? null)) {
        const prev = currentRoomRef.current;
        currentRoomRef.current = room;
        setCurrentRoom(room);
        if (orgId) {
          if (prev) void recordPresenceEvent({ orgId, kind: "room_leave", roomKey: prev.key });
          if (room) void recordPresenceEvent({ orgId, kind: "room_enter", roomKey: room.key });
        }
      }
    }, 300);
    return () => clearInterval(id);
  }, [orgId]);

  // Record office join/leave for analytics (opt-in enforced server-side).
  useEffect(() => {
    if (!orgId) return;
    void recordPresenceEvent({ orgId, kind: "join" });
    return () => {
      void recordPresenceEvent({ orgId, kind: "leave" });
    };
  }, [orgId]);

  const changeStatus = useCallback(
    (s: PresenceStatus) => {
      statusRef.current = s;
      setStatus(s);
      track();
      if (orgId) void recordPresenceEvent({ orgId, kind: "status", status: s });
    },
    [track, orgId],
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

  const selfParticipant: Participant = {
    id: userId,
    name: displayName,
    kind: "human",
    x: selfTile.x,
    y: selfTile.y,
    color: myColor,
    status,
  };
  const officeHumans = [...remotes, selfParticipant];
  const humanCount = remotes.length + 1 + (demoMode ? demoParticipants(0).length : 0);
  const voiceTiles: { id: string; stream: MediaStream; label: string }[] = [];
  if (voice.localStream && voice.camOn) {
    voiceTiles.push({ id: "self", stream: voice.localStream, label: "You" });
  }
  for (const [peerId, stream] of voice.peerStreams) {
    const who = remotes.find((r) => r.id === peerId);
    voiceTiles.push({ id: peerId, stream, label: who?.name ?? "Teammate" });
  }

  return (
    <div ref={wrapRef} className="fx-ambient">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            Virtual Office
          </span>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
            Your team, in one room
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
            A spatial workspace where your executive agents work at their desks
            and teammates gather in real time. Move with{" "}
            <kbd className="rounded bg-surface-2 px-1 font-mono text-xs">WASD</kbd>{" "}
            or click to walk over — step inside someone&apos;s ring to start a
            spatial conversation.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setDemoMode((v) => !v)}
            className={`rounded-md border px-2.5 py-1.5 text-xs transition ${
              demoMode
                ? "border-gold-400/60 bg-gold-400/10 text-fg-primary"
                : "border-surface-3/50 text-fg-secondary hover:bg-surface-2"
            }`}
          >
            {demoMode ? "Demo: on" : "Demo mode"}
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-surface-3/50 px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2"
          >
            {editing ? "Close editor" : "Edit office"}
          </button>
          <button
            type="button"
            onClick={tour.reopen}
            className="rounded-md border border-surface-3/50 px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2"
          >
            Take the tour
          </button>
          <Link
            href="/office/analytics"
            className="rounded-md border border-surface-3/50 px-2.5 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2"
          >
            Analytics
          </Link>
        </div>
      </header>

      {editing && (
        <div className="mb-4 rounded-xl border border-surface-3/60 bg-surface-1 p-4">
          <OfficeMapEditor
            initial={layoutState}
            onSaved={(d) => {
              setLayoutState(d);
              setEditing(false);
            }}
          />
        </div>
      )}

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
          <RoomCallDock
            orgId={orgId ?? ""}
            currentRoom={currentRoom}
            participants={officeHumans}
          />

          {!hasRealtime && (
            <div className="rounded-lg border border-gold-400/30 bg-gold-400/5 p-3 text-xs text-fg-secondary">
              Live co-presence and voice need Supabase Realtime configured.
              You&apos;re in solo mode — your agents are here, teammates appear
              once it&apos;s connected.
            </div>
          )}

          {/* Voice */}
          <section>
            <h2 className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              <span>Spatial voice</span>
              {voice.connected && (
                <span className="text-status-success">● live</span>
              )}
            </h2>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={voice.toggleMic}
                disabled={!hasRealtime}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition disabled:opacity-40 ${
                  voice.micOn
                    ? "border-status-success/60 bg-status-success/10 text-fg-primary"
                    : "border-surface-3/50 text-fg-secondary hover:bg-surface-2"
                }`}
              >
                {voice.micOn ? "🎙 Mic on" : "🔇 Mic off"}
              </button>
              <button
                type="button"
                onClick={voice.toggleCam}
                disabled={!hasRealtime}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition disabled:opacity-40 ${
                  voice.camOn
                    ? "border-status-success/60 bg-status-success/10 text-fg-primary"
                    : "border-surface-3/50 text-fg-secondary hover:bg-surface-2"
                }`}
              >
                {voice.camOn ? "📹 Cam on" : "📷 Cam off"}
              </button>
            </div>
            {voice.error && (
              <p className="mt-1.5 text-[11px] text-status-danger">{voice.error}</p>
            )}
            {!voice.error && (
              <p className="mt-1.5 text-[11px] text-fg-muted">
                Voices fade in as you approach — {voice.peerStreams.size} in range.
              </p>
            )}
            {voiceTiles.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {voiceTiles.map((t) => (
                  <VideoTile key={t.id} stream={t.stream} label={t.label} />
                ))}
              </div>
            )}
          </section>

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
                        {p.kind === "agent"
                          ? p.activityLabel || p.role
                          : STATUS_LABELS[p.status]}
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
                {humanCount} · {desks.length} agents
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

      <OfficeTour open={tour.open} onClose={tour.dismiss} />

      <div className="fixed bottom-4 right-4 z-40">
        <OfficeChat
          orgId={orgId ?? ""}
          userId={userId}
          displayName={displayName}
          color={myColor}
          getSelfPos={() => posRef.current}
          enabled={hasRealtime && !!orgId}
        />
      </div>
    </div>
  );
}
