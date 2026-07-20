"use client";

// The spatial-meeting dock. When the current human standing position is inside
// an office room of type "meeting", this surfaces a small panel that (a) lists
// who else is in the room, (b) opens the EXISTING meetings call for a
// deterministic room id — so everyone in the same spatial room joins the same
// call — and (c) shows the latest AI notes snapshot for that room if available.
//
// It reuses the meetings pipeline wholesale: `/api/meetings/create` (which calls
// `createMeeting`, upserting on room_code) mints/opens the room, `/meetings/<id>`
// is the real call route, and `live_meetings.notes_snapshot` is the persisted
// output of the live-notes pipeline. Nothing about the call stack is duplicated.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { OfficeRoom } from "@/lib/office/layout";
import type { Participant } from "@/lib/office/presence";
import { isMeetingRoom, officeMeetingRoomId, roomOccupants } from "@/lib/office/meetingRooms";

interface RoomNotes {
  summary: string;
  key_points: string[];
  action_items: string[];
  decisions: string[];
}

function coerceNotes(raw: unknown): RoomNotes | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const notes: RoomNotes = {
    summary: typeof r.summary === "string" ? r.summary : "",
    key_points: list(r.key_points),
    action_items: list(r.action_items),
    decisions: list(r.decisions),
  };
  if (!notes.summary && !notes.action_items.length && !notes.decisions.length) return null;
  return notes;
}

export function RoomCallDock({
  orgId,
  currentRoom,
  participants,
}: {
  orgId: string;
  currentRoom: OfficeRoom | null;
  participants: Participant[];
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [notes, setNotes] = useState<RoomNotes | null>(null);

  const active = currentRoom && isMeetingRoom(currentRoom) ? currentRoom : null;
  const roomId = active ? officeMeetingRoomId(orgId, active.key) : null;

  // Pull the latest persisted notes snapshot for this room's call, if one exists.
  // Degrades silently: any error (no row yet, RLS, offline) just leaves notes null.
  useEffect(() => {
    if (!roomId) {
      setNotes(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("live_meetings")
          .select("notes_snapshot")
          .eq("room_code", roomId)
          .maybeSingle();
        if (cancelled) return;
        const snapshot = (data as { notes_snapshot?: unknown } | null)?.notes_snapshot;
        setNotes(coerceNotes(snapshot));
      } catch {
        if (!cancelled) setNotes(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const joinCall = useCallback(async () => {
    if (!roomId || joining) return;
    setJoining(true);
    try {
      // Reuse the meetings service via its API route: createMeeting upserts on
      // room_code, so concurrent joiners converge on one call. If it fails
      // (e.g. transient), still navigate — the meeting room auto-creates on entry.
      await fetch("/api/meetings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: active?.label ?? "Meeting", roomCode: roomId }),
      }).catch(() => null);
    } finally {
      router.push(`/meetings/${roomId}`);
    }
  }, [roomId, joining, active, router]);

  if (!active || !roomId) return null;

  const occupants = roomOccupants(active, participants);

  return (
    <div className="w-72 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
            Meeting room
          </span>
          <span className="text-sm font-semibold text-[var(--fg-primary)]">{active.label}</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-400)]/25 bg-[var(--gold-400)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--gold-400)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-400)]" />
          {occupants.length} here
        </span>
      </div>

      {/* Occupants */}
      <div className="mt-3 flex flex-col gap-1">
        {occupants.length === 0 ? (
          <p className="text-xs text-[var(--fg-muted)]">
            You&apos;re the first one here. Start the call and others can join by walking in.
          </p>
        ) : (
          occupants.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate text-sm text-[var(--fg-secondary)]">{p.name}</span>
            </div>
          ))
        )}
      </div>

      {/* Join */}
      <button
        type="button"
        onClick={() => void joinCall()}
        disabled={joining}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold-400)] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--gold-500)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {joining ? "Opening…" : "Join call"}
      </button>

      {/* Latest AI notes for this room (persisted snapshot) */}
      {notes ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-[var(--line)] pt-3">
          <span className="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
            Latest notes
          </span>
          {notes.summary ? (
            <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">{notes.summary}</p>
          ) : null}
          {notes.action_items.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-[0.6rem] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                Action items
              </p>
              {notes.action_items.slice(0, 4).map((item, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-[var(--fg-primary)]">
                  <span className="mt-0.5 shrink-0 text-[var(--gold-400)]">☐</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          ) : null}
          {notes.decisions.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-[0.6rem] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                Decisions
              </p>
              {notes.decisions.slice(0, 4).map((d, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-[var(--fg-primary)]">
                  <span className="mt-0.5 shrink-0 text-[var(--gold-400)]">✓</span>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
