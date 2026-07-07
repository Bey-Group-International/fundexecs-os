"use client";

import { useEffect, useRef, useState } from "react";

type VideoTile = { peerId: string; label: string; el: HTMLVideoElement };

/** A single participant video, wired to a MediaStream (local or a peer's el). */
function Tile({ stream, label, you, dimmed }: { stream: MediaStream | null; label: string; you?: boolean; dimmed?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5" style={{ opacity: dimmed ? 0.55 : 1 }}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={you}
        className="h-[84px] w-[112px] rounded-lg border object-cover"
        style={{ background: "#12100c", borderColor: you ? "rgba(34,197,94,0.5)" : "rgba(201,168,76,0.4)" }}
      />
      <span className="max-w-[112px] truncate text-[9px]" style={{ color: you ? "#22c55e" : "#c9a84c" }}>
        {label}{you ? " (you)" : ""}
      </span>
    </div>
  );
}

/**
 * In-office meeting dock — a floating real-time video panel pinned over the
 * office canvas near the room selector. Reuses the floor's WebRTC video (your
 * camera + teammates in your proximity bubble); ending stops your camera and
 * closes the dock. An invite panel collects names/emails and shares the floor
 * link (copy or email) so teammates can join you on the floor.
 */
export function MeetingDock({
  localStream,
  tiles,
  localLabel,
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onEnd,
  inviteUrl,
}: {
  localStream: MediaStream | null;
  tiles: VideoTile[];
  localLabel: string;
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onEnd: () => void;
  inviteUrl: string;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [invitees, setInvitees] = useState<Array<{ name: string; email: string }>>([]);
  const [copied, setCopied] = useState(false);

  const count = tiles.length + (localStream ? 1 : 0);

  const addInvitee = () => {
    const em = email.trim();
    if (!em) return;
    setInvitees((prev) => (prev.some((i) => i.email === em) ? prev : [...prev, { name: name.trim() || em, email: em }]));
    setName("");
    setEmail("");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  const emailInvites = () => {
    const to = invitees.map((i) => i.email).join(",");
    const subject = encodeURIComponent("Join me in the FundExecs Executive Floor");
    const body = encodeURIComponent(`You're invited to an in-office meeting. Join the floor here:\n\n${inviteUrl}`);
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-2 z-30 flex -translate-x-1/2 flex-col gap-2 rounded-xl border p-2 shadow-xl backdrop-blur-sm"
      style={{
        background: "rgba(10,8,6,0.92)",
        borderColor: "rgba(201,168,76,0.4)",
        maxWidth: "min(94%, 560px)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} />
          In-office meeting · {count}
        </span>
        <button
          type="button"
          onClick={onEnd}
          className="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors"
          style={{ color: "#fff", background: "#b3423e" }}
        >
          End
        </button>
      </div>

      {/* Participant video tiles */}
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {localStream ? <Tile stream={localStream} label={localLabel} you dimmed={!camOn} /> : null}
        {tiles.map((t) => (
          <Tile key={t.peerId} stream={t.el.srcObject as MediaStream | null} label={t.label} />
        ))}
        {tiles.length === 0 ? (
          <div className="grid h-[84px] flex-1 place-items-center rounded-lg border border-dashed px-3 text-center text-[10px] text-fg-muted" style={{ borderColor: "rgba(201,168,76,0.25)" }}>
            Waiting for teammates — invite someone or walk together on the floor.
          </div>
        ) : null}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleMic}
          aria-pressed={micOn}
          title={micOn ? "Mute" : "Unmute"}
          className="rounded-md px-2 py-1 text-[11px] transition-colors"
          style={{ color: micOn ? "#c9a84c" : "#b3423e", border: `1px solid ${micOn ? "rgba(201,168,76,0.4)" : "rgba(179,66,62,0.6)"}`, background: "rgba(201,168,76,0.06)" }}
        >
          {micOn ? "🎙 Mic" : "🔇 Muted"}
        </button>
        <button
          type="button"
          onClick={onToggleCam}
          aria-pressed={camOn}
          title={camOn ? "Turn camera off" : "Turn camera on"}
          className="rounded-md px-2 py-1 text-[11px] transition-colors"
          style={{ color: camOn ? "#c9a84c" : "#b3423e", border: `1px solid ${camOn ? "rgba(201,168,76,0.4)" : "rgba(179,66,62,0.6)"}`, background: "rgba(201,168,76,0.06)" }}
        >
          {camOn ? "🎥 Camera" : "🚫 Camera"}
        </button>
        <button
          type="button"
          onClick={() => setInviteOpen((v) => !v)}
          aria-expanded={inviteOpen}
          className="ml-auto rounded-md px-2 py-1 text-[11px] transition-colors"
          style={{ color: "#0a0806", background: "#c9a84c" }}
        >
          ＋ Invite
        </button>
      </div>

      {/* Invite panel */}
      {inviteOpen ? (
        <div className="flex flex-col gap-2 rounded-lg border p-2" style={{ borderColor: "rgba(201,168,76,0.22)", background: "rgba(201,168,76,0.05)" }}>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-[12px] text-fg-primary outline-none"
              style={{ borderColor: "rgba(201,168,76,0.25)" }}
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addInvitee(); }}
              type="email"
              placeholder="name@firm.com"
              className="min-w-0 flex-[2] rounded-md border bg-transparent px-2 py-1 text-[12px] text-fg-primary outline-none"
              style={{ borderColor: "rgba(201,168,76,0.25)" }}
            />
            <button
              type="button"
              onClick={addInvitee}
              className="rounded-md px-2 py-1 text-[11px]"
              style={{ color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)" }}
            >
              Add
            </button>
          </div>

          {invitees.length > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {invitees.map((i) => (
                <li key={i.email} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]" style={{ background: "rgba(201,168,76,0.12)", color: "#e8e2d4" }}>
                  {i.name}
                  <button type="button" aria-label={`Remove ${i.name}`} onClick={() => setInvitees((prev) => prev.filter((x) => x.email !== i.email))} className="text-fg-muted hover:text-fg-primary">×</button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-1.5">
            <button type="button" onClick={copyLink} className="rounded-md px-2 py-1 text-[10px] uppercase tracking-[0.06em]" style={{ color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)" }}>
              {copied ? "Link copied ✓" : "Copy floor link"}
            </button>
            <button
              type="button"
              onClick={emailInvites}
              disabled={invitees.length === 0}
              className="rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "#0a0806", background: "#c9a84c" }}
            >
              Email {invitees.length || ""} invite{invitees.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
