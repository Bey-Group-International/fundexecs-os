"use client";

import { useEffect, useRef, useState } from "react";

type VideoTile = { peerId: string; label: string; el: HTMLVideoElement };
type Devices = { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };

const GOLD = "#c9a84c";
const TEXT = "#f1ece1"; // primary — high contrast on the dark dock
const SUBTLE = "#cbd2dc"; // secondary — still clearly legible

const speakerSelectable =
  typeof window !== "undefined" &&
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype;

/** A single participant video, wired to a MediaStream and (optionally) a sink. */
function Tile({ stream, label, you, dimmed, sinkId }: { stream: MediaStream | null; label: string; you?: boolean; dimmed?: boolean; sinkId?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    const v = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (v && sinkId && !you && v.setSinkId) v.setSinkId(sinkId).catch(() => {});
  }, [sinkId, you]);
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5" style={{ opacity: dimmed ? 0.5 : 1 }}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={you}
        className="h-[84px] w-[112px] rounded-lg border object-cover"
        style={{ background: "#12100c", borderColor: you ? "rgba(34,197,94,0.6)" : "rgba(201,168,76,0.45)" }}
      />
      <span className="max-w-[112px] truncate text-[10px] font-medium" style={{ color: you ? "#4ade80" : GOLD }}>
        {label}{you ? " (you)" : ""}
      </span>
    </div>
  );
}

/** A device label with a sensible fallback when permissions hide the name. */
function deviceName(d: MediaDeviceInfo, fallback: string, i: number) {
  return d.label || `${fallback} ${i + 1}`;
}

/**
 * A sleek control: a round icon button plus (when devices are available) a small
 * caret that opens a device-picker dropdown. Mic/camera pass `onToggle` (the
 * icon mutes/unmutes); the speaker picker omits it (the icon opens the menu).
 */
function Control({
  icon, title, active = true, danger = false, onToggle, devices, selectedId, onSelect, deviceFallback,
}: {
  icon: string;
  title: string;
  active?: boolean;
  danger?: boolean;
  onToggle?: () => void;
  devices?: MediaDeviceInfo[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  deviceFallback?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasMenu = !!devices && devices.length > 0 && !!onSelect;
  const off = !active;
  const color = danger ? "#ef6b66" : off ? "#ef6b66" : GOLD;
  const border = danger ? "rgba(239,107,102,0.6)" : off ? "rgba(239,107,102,0.55)" : "rgba(201,168,76,0.5)";

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={onToggle ?? (() => hasMenu && setOpen((v) => !v))}
        title={title}
        aria-label={title}
        className="grid h-8 w-8 place-items-center rounded-full text-[13px] transition-colors"
        style={{ color, border: `1px solid ${border}`, background: "rgba(201,168,76,0.07)", borderTopRightRadius: hasMenu ? 4 : 999, borderBottomRightRadius: hasMenu ? 4 : 999 }}
      >
        {icon}
      </button>
      {hasMenu ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Choose ${title.toLowerCase()}`}
          aria-expanded={open}
          className="grid h-8 w-4 place-items-center rounded-r-full text-[8px] transition-colors"
          style={{ color: GOLD, border: "1px solid rgba(201,168,76,0.5)", borderLeft: "none", background: "rgba(201,168,76,0.07)" }}
        >
          ▾
        </button>
      ) : null}
      {open && hasMenu ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-full left-0 z-50 mb-1 max-h-[180px] w-[200px] overflow-y-auto rounded-lg border p-1 shadow-xl"
            style={{ background: "rgba(14,12,9,0.98)", borderColor: "rgba(201,168,76,0.35)" }}
          >
            {devices!.map((d, i) => {
              const sel = d.deviceId === selectedId;
              return (
                <button
                  key={d.deviceId}
                  type="button"
                  onClick={() => { onSelect!(d.deviceId); setOpen(false); }}
                  className="flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left text-[11px] transition-colors"
                  style={{ color: sel ? GOLD : TEXT, background: sel ? "rgba(201,168,76,0.12)" : "transparent" }}
                >
                  <span style={{ width: 8, color: GOLD }}>{sel ? "✓" : ""}</span>
                  <span className="truncate">{deviceName(d, deviceFallback ?? "Device", i)}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * In-office meeting dock — a floating real-time video panel pinned over the
 * office canvas near the room selector. Reuses the floor's WebRTC video (your
 * camera + teammates in your proximity bubble). Sleek icon controls with device
 * dropdowns (mic / camera / speaker), and an invite panel that emails the floor
 * link server-side (no mailto / external app).
 */
export function MeetingDock({
  localStream, tiles, localLabel, micOn, camOn, onToggleMic, onToggleCam, onEnd, inviteUrl,
  blurOn = false, blurBusy = false, blurSupported = false, onToggleBlur,
  devices, selectedMic, selectedCam, selectedSpeaker,
  onSelectMic, onSelectCam, onSelectSpeaker, onSendInvites,
  waiting = [], onSummon,
}: {
  localStream: MediaStream | null;
  tiles: VideoTile[];
  localLabel: string;
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onEnd: () => void;
  /** Virtual-background (on-device blur) state + control. */
  blurOn?: boolean;
  blurBusy?: boolean;
  blurSupported?: boolean;
  onToggleBlur?: () => void;
  inviteUrl: string;
  devices: Devices;
  selectedMic: string;
  selectedCam: string;
  selectedSpeaker: string;
  onSelectMic: (id: string) => void;
  onSelectCam: (id: string) => void;
  onSelectSpeaker: (id: string) => void;
  onSendInvites: (emails: string[]) => Promise<{ ok: boolean; sent: number }>;
  /** Teammates on the floor but not yet in the call — the meeting "waiting room". */
  waiting?: { id: string; name: string; roomLabel: string | null }[];
  /** Summon a waiting teammate into the meeting (walks their avatar over). */
  onSummon?: (id: string, name: string) => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [invitees, setInvitees] = useState<Array<{ name: string; email: string }>>([]);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);

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

  const emailInvites = async () => {
    if (invitees.length === 0 || sending) return;
    setSending(true);
    setSentMsg(null);
    const res = await onSendInvites(invitees.map((i) => i.email));
    setSending(false);
    if (res.ok) {
      setSentMsg(`Sent ${res.sent} invite${res.sent === 1 ? "" : "s"} ✓`);
      setInvitees([]);
    } else {
      setSentMsg("Couldn't send — try again");
    }
    window.setTimeout(() => setSentMsg(null), 2600);
  };

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-2 z-30 flex -translate-x-1/2 flex-col gap-2 rounded-xl border p-2 shadow-xl backdrop-blur-sm"
      style={{
        background: "rgba(8,6,4,0.94)",
        borderColor: "rgba(201,168,76,0.45)",
        maxWidth: "min(94%, 560px)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: SUBTLE }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} />
          In-office meeting · {count}
        </span>
        <button
          type="button"
          onClick={onEnd}
          className="rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors"
          style={{ color: "#fff", background: "#b3423e" }}
        >
          End
        </button>
      </div>

      {/* Participant video tiles */}
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {localStream ? <Tile stream={localStream} label={localLabel} you dimmed={!camOn} /> : null}
        {tiles.map((t) => (
          <Tile key={t.peerId} stream={t.el.srcObject as MediaStream | null} label={t.label} sinkId={selectedSpeaker} />
        ))}
        {tiles.length === 0 && waiting.length === 0 ? (
          <div className="grid h-[84px] flex-1 place-items-center rounded-lg border border-dashed px-3 text-center text-[11px]" style={{ borderColor: "rgba(201,168,76,0.3)", color: SUBTLE }}>
            Waiting for teammates — invite someone or walk together on the floor.
          </div>
        ) : null}
      </div>

      {/* Waiting room — teammates on the floor not yet in the call. "Add" walks
          them over to join. */}
      {waiting.length > 0 && (
        <div className="rounded-lg border p-1.5" style={{ borderColor: "rgba(201,168,76,0.22)", background: "rgba(201,168,76,0.05)" }}>
          <p className="mb-1 px-0.5 font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: SUBTLE }}>
            On the floor
          </p>
          <ul className="flex max-h-[104px] flex-col gap-0.5 overflow-y-auto">
            {waiting.map((w) => (
              <li key={w.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: "#64748b" }} />
                <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: TEXT }}>
                  {w.name}
                  {w.roomLabel ? <span style={{ color: SUBTLE }}>{` · ${w.roomLabel}`}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => onSummon?.(w.id, w.name)}
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors"
                  style={{ color: "#0a0806", background: GOLD }}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sleek control row: mic / camera / speaker (with device menus) + actions */}
      <div className="flex items-center gap-1.5">
        <Control
          icon={micOn ? "🎙" : "🔇"} title={micOn ? "Mute" : "Unmute"} active={micOn} onToggle={onToggleMic}
          devices={devices.mics} selectedId={selectedMic} onSelect={onSelectMic} deviceFallback="Microphone"
        />
        <Control
          icon={camOn ? "🎥" : "🚫"} title={camOn ? "Turn camera off" : "Turn camera on"} active={camOn} onToggle={onToggleCam}
          devices={devices.cams} selectedId={selectedCam} onSelect={onSelectCam} deviceFallback="Camera"
        />
        {blurSupported && onToggleBlur ? (
          <button
            type="button"
            onClick={onToggleBlur}
            disabled={blurBusy}
            title={blurBusy ? "Loading background blur…" : blurOn ? "Turn background blur off" : "Blur my background"}
            aria-label="Toggle background blur"
            aria-pressed={blurOn}
            className="grid h-8 w-8 place-items-center rounded-full text-[13px] transition-colors disabled:opacity-50"
            style={{
              color: blurOn ? "#0a0806" : GOLD,
              border: `1px solid ${blurOn ? GOLD : "rgba(201,168,76,0.5)"}`,
              background: blurOn ? GOLD : "rgba(201,168,76,0.07)",
            }}
          >
            {blurBusy ? "…" : "🌫"}
          </button>
        ) : null}
        {speakerSelectable && devices.speakers.length > 0 ? (
          <Control
            icon="🔊" title="Speaker"
            devices={devices.speakers} selectedId={selectedSpeaker} onSelect={onSelectSpeaker} deviceFallback="Speaker"
          />
        ) : null}

        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={copyLink}
            title="Copy floor link"
            aria-label="Copy floor link"
            className="grid h-8 w-8 place-items-center rounded-full text-[13px] transition-colors"
            style={{ color: copied ? "#4ade80" : GOLD, border: `1px solid ${copied ? "rgba(74,222,128,0.6)" : "rgba(201,168,76,0.5)"}`, background: "rgba(201,168,76,0.07)" }}
          >
            {copied ? "✓" : "🔗"}
          </button>
          <button
            type="button"
            onClick={() => setInviteOpen((v) => !v)}
            aria-expanded={inviteOpen}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors"
            style={{ color: "#0a0806", background: GOLD }}
          >
            ✉ Invite
          </button>
        </span>
      </div>

      {/* Invite panel — emails the floor link server-side (no mailto). */}
      {inviteOpen ? (
        <div className="flex flex-col gap-2 rounded-lg border p-2" style={{ borderColor: "rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.06)" }}>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none placeholder:text-[#9aa4b2]"
              style={{ borderColor: "rgba(201,168,76,0.3)", color: TEXT }}
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addInvitee(); }}
              type="email"
              placeholder="name@firm.com"
              className="min-w-0 flex-[2] rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none placeholder:text-[#9aa4b2]"
              style={{ borderColor: "rgba(201,168,76,0.3)", color: TEXT }}
            />
            <button type="button" onClick={addInvitee} className="rounded-md px-2.5 py-1 text-[11px] font-medium" style={{ color: GOLD, border: "1px solid rgba(201,168,76,0.5)" }}>
              Add
            </button>
          </div>

          {invitees.length > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {invitees.map((i) => (
                <li key={i.email} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]" style={{ background: "rgba(201,168,76,0.16)", color: TEXT }}>
                  {i.name}
                  <button type="button" aria-label={`Remove ${i.name}`} onClick={() => setInvitees((prev) => prev.filter((x) => x.email !== i.email))} style={{ color: SUBTLE }}>×</button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={emailInvites}
              disabled={invitees.length === 0 || sending}
              className="rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: "#0a0806", background: GOLD }}
            >
              {sending ? "Sending…" : `Email ${invitees.length || ""} invite${invitees.length === 1 ? "" : "s"}`.trim()}
            </button>
            {sentMsg ? <span className="text-[11px]" style={{ color: sentMsg.includes("✓") ? "#4ade80" : "#ef6b66" }}>{sentMsg}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
