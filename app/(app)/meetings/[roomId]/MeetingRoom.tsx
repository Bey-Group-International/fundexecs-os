"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { LiveNotesResult } from "@/app/api/meetings/notes/route";
import { MeetingCopilotConsole } from "@/app/(app)/meetings/MeetingCopilotConsole";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Peer { id: string; displayName: string; stream: MediaStream | null }
interface TranscriptLine { id: string; speaker: string; text: string; ts: number; final: boolean }
interface ChatMessage { id: string; from: string; displayName: string; text: string; ts: number }
interface WaitingPeer { from: string; displayName: string }

type SignalMsg =
  | { type: "join"; from: string; displayName: string }
  | { type: "leave"; from: string }
  | { type: "end"; from: string }
  | { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: "transcript"; from: string; speaker: string; text: string; ts: number }
  | { type: "chat"; from: string; displayName: string; text: string; ts: number }
  | { type: "raise_hand"; from: string; raised: boolean }
  | { type: "reaction"; from: string; emoji: string; ts: number }
  | { type: "mute_all"; from: string }
  | { type: "kick"; from: string; target: string }
  | { type: "admit_request"; from: string; displayName: string }
  | { type: "admit"; from: string; target: string }
  | { type: "deny"; from: string; target: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const NOTES_INTERVAL_MS = 15_000;
const TRANSCRIPT_FLUSH_MS = 60_000;
const REACTIONS = ["👍", "👏", "😂", "❤️", "🎉", "🤔"];

// Synthesize a short chime using Web Audio API (no audio files needed)
function playChime(type: "join" | "leave") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === "join") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.1);
    }
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => void ctx.close();
  } catch { /* AudioContext not available */ }
}

// ─── VideoTile ────────────────────────────────────────────────────────────────

function VideoTile({
  stream, label, muted = false, isLocal = false,
  handRaised = false, reaction = "", large = false,
}: {
  stream: MediaStream | null; label: string; muted?: boolean; isLocal?: boolean;
  handRaised?: boolean; reaction?: string; large?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (videoRef.current && stream) videoRef.current.srcObject = stream; }, [stream]);
  const hasVideo = stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live");

  return (
    <div className={`relative rounded-2xl overflow-hidden bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center ${large ? "w-full h-full" : "aspect-video"}`}>
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={muted}
          className={`w-full h-full object-cover ${isLocal ? "scale-x-[-1]" : ""}`} />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-lg font-semibold text-[var(--fg-primary)]">
            {label.slice(0, 1).toUpperCase()}
          </div>
          <span className="text-xs text-[var(--fg-muted)]">Camera off</span>
        </div>
      )}
      <div className="absolute bottom-2 left-3 rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-xs text-white">
        {label}{isLocal ? " (You)" : ""}
      </div>
      {handRaised && <div className="absolute top-2 right-3 text-lg">✋</div>}
      {reaction && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl animate-bounce pointer-events-none select-none">
          {reaction}
        </div>
      )}
    </div>
  );
}

// ─── DeviceChevron ────────────────────────────────────────────────────────────

function DeviceChevron({ kind, onSelect }: { kind: "audioinput" | "videoinput" | "audiooutput"; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const openPicker = async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevs(all.filter((d) => d.kind === kind && d.deviceId));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => void openPicker()}
        className="flex items-center justify-center w-4 h-4 text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-7 left-1/2 -translate-x-1/2 z-50 min-w-[200px] rounded-xl border border-[var(--line)] bg-[var(--surface-2)] shadow-xl p-1">
          <p className="text-[10px] font-medium text-[var(--fg-muted)] uppercase tracking-wide px-2 py-1">
            {kind === "audioinput" ? "Microphone" : kind === "videoinput" ? "Camera" : "Speaker"}
          </p>
          {devs.length === 0 ? <p className="text-xs text-[var(--fg-muted)] px-2 py-1">No devices found</p> : devs.map((d: MediaDeviceInfo) => (
            <button key={d.deviceId} onClick={() => { onSelect(d.deviceId); setOpen(false); }}
              className="w-full text-left text-xs text-[var(--fg-primary)] px-2 py-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors truncate">
              {d.label || `Device ${d.deviceId.slice(0, 6)}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CtrlBtn ──────────────────────────────────────────────────────────────────

function CtrlBtn({ active, onClick, title, activeIcon, inactiveIcon }: {
  active: boolean; onClick: () => void; title: string; activeIcon: React.ReactNode; inactiveIcon: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title}
      className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
        active ? "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] hover:bg-[var(--surface-3)]"
               : "border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 text-[var(--status-danger)]"
      }`}>
      {active ? activeIcon : inactiveIcon}
    </button>
  );
}

// ─── ControlBar ───────────────────────────────────────────────────────────────

function ControlBar({
  micOn, camOn, shareOn, copilotOpen, isHost, handRaised, layout, chatUnread, duration, roomCode, bwMode,
  onToggleMic, onToggleCam, onToggleScreen, onToggleCopilot, onLeave, onEndForAll,
  onSwitchMic, onSwitchCam, onSwitchSpeaker, onRaiseHand, onReaction, onMuteAll, onToggleLayout,
}: {
  micOn: boolean; camOn: boolean; shareOn: boolean; copilotOpen: boolean; isHost: boolean;
  handRaised: boolean; layout: "grid" | "speaker"; chatUnread: number; duration: number;
  roomCode: string; bwMode: "normal" | "degraded" | "audio-only";
  onToggleMic: () => void; onToggleCam: () => void; onToggleScreen: () => void;
  onToggleCopilot: () => void; onLeave: () => void; onEndForAll: () => void;
  onSwitchMic: (id: string) => void; onSwitchCam: (id: string) => void; onSwitchSpeaker: (id: string) => void;
  onRaiseHand: () => void; onReaction: (emoji: string) => void; onMuteAll: () => void; onToggleLayout: () => void;
}) {
  const mins = String(Math.floor(duration / 60)).padStart(2, "0");
  const secs = String(duration % 60).padStart(2, "0");
  const [reactionOpen, setReactionOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const reactionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reactionOpen) return;
    const h = (e: MouseEvent) => { if (reactionRef.current && !reactionRef.current.contains(e.target as Node)) setReactionOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [reactionOpen]);

  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--line)] bg-[var(--surface-1)] shrink-0">
      <span className="text-xs font-mono text-[var(--fg-muted)] tabular-nums w-16">{mins}:{secs}</span>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-0.5">
          <CtrlBtn active={micOn} onClick={onToggleMic} title={micOn ? "Mute" : "Unmute"} activeIcon={<MicIcon />} inactiveIcon={<MicOffIcon />} />
          <DeviceChevron kind="audioinput" onSelect={onSwitchMic} />
        </div>
        <div className="flex items-center gap-0.5">
          <CtrlBtn active={camOn} onClick={onToggleCam} title={camOn ? "Camera off" : "Camera on"} activeIcon={<CamIcon />} inactiveIcon={<CamOffIcon />} />
          <DeviceChevron kind="videoinput" onSelect={onSwitchCam} />
        </div>
        <div className="flex items-center gap-0.5">
          <CtrlBtn active onClick={() => {}} title="Speaker" activeIcon={<SpeakerIcon />} inactiveIcon={<SpeakerIcon />} />
          <DeviceChevron kind="audiooutput" onSelect={onSwitchSpeaker} />
        </div>
        <CtrlBtn active={shareOn} onClick={onToggleScreen} title={shareOn ? "Stop sharing" : "Share screen"} activeIcon={<ScreenShareIcon />} inactiveIcon={<ScreenShareIcon />} />

        {/* Raise hand */}
        <button onClick={onRaiseHand} title={handRaised ? "Lower hand" : "Raise hand"}
          className={`w-10 h-10 rounded-full border flex items-center justify-center text-base transition-colors ${
            handRaised ? "border-[var(--gold-400)]/60 bg-[var(--gold-400)]/10 text-[var(--gold-400)]"
                       : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] hover:bg-[var(--surface-3)]"
          }`}>✋</button>

        {/* Reactions */}
        <div ref={reactionRef} className="relative">
          <button onClick={() => setReactionOpen((v: boolean) => !v)} title="Send reaction"
            className="w-10 h-10 rounded-full border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] flex items-center justify-center text-base transition-colors">
            😊
          </button>
          {reactionOpen && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] shadow-xl p-2">
              {REACTIONS.map((emoji) => (
                <button key={emoji} onClick={() => { onReaction(emoji); setReactionOpen(false); }}
                  className="w-8 h-8 flex items-center justify-center text-xl rounded-lg hover:bg-[var(--surface-3)] transition-colors">
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Layout toggle */}
        <button onClick={onToggleLayout} title={layout === "grid" ? "Speaker view" : "Grid view"}
          className="w-10 h-10 rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-3)] flex items-center justify-center transition-colors">
          {layout === "grid" ? <SpeakerViewIcon /> : <GridViewIcon />}
        </button>

        {isHost && (
          <button onClick={onMuteAll} title="Mute all participants"
            className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] px-3 h-10 text-xs font-medium transition-colors">
            Mute all
          </button>
        )}

        {isHost ? (
          <button onClick={onEndForAll}
            className="flex items-center gap-2 rounded-full bg-[var(--status-danger)] hover:bg-red-600 text-white text-sm font-medium px-5 py-2 transition-colors">
            <PhoneOffIcon /> End for all
          </button>
        ) : (
          <button onClick={onLeave}
            className="flex items-center gap-2 rounded-full bg-[var(--status-danger)] hover:bg-red-600 text-white text-sm font-medium px-5 py-2 transition-colors">
            <PhoneOffIcon /> Leave
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {bwMode === "audio-only" && (
          <span title="Low bandwidth — video paused to maintain audio" className="text-xs text-[var(--status-warning)] flex items-center gap-1 border border-[var(--status-warning)]/30 rounded-full px-2 py-1">
            📶 Low BW
          </span>
        )}
        <button
          onClick={() => {
            const link = `${window.location.origin}/meetings/${roomCode}`;
            void navigator.clipboard.writeText(link).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); });
          }}
          title="Copy meeting link"
          className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-3)] px-3 h-8 text-xs font-medium transition-colors">
          {linkCopied ? "✓ Copied" : "Copy link"}
        </button>
        <button onClick={onToggleCopilot}
          className={`relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            copilotOpen ? "border-[var(--gold-400)] bg-[var(--gold-400)]/10 text-[var(--gold-400)]"
                        : "border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
          }`}>
          ✨ Copilot
          {chatUnread > 0 && !copilotOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--gold-400)] text-black text-[10px] font-bold flex items-center justify-center">
              {chatUnread}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── CopilotSidebar ───────────────────────────────────────────────────────────

function CopilotSidebar({
  transcript, notes, isUpdating, srStatus, participants, roomCode,
  chatMessages, onSendChat, isHost, raisedHands, onKick, onAdmit, onDeny, waitingPeers, onChatOpen,
}: {
  transcript: TranscriptLine[]; notes: LiveNotesResult | null; isUpdating: boolean;
  srStatus: "idle" | "active" | "error" | "unsupported";
  participants: { id: string; displayName: string }[];
  roomCode: string; chatMessages: ChatMessage[];
  onSendChat: (text: string) => void; isHost: boolean;
  raisedHands: Set<string>; onKick: (id: string) => void;
  onAdmit: (id: string) => void; onDeny: (id: string) => void;
  waitingPeers: WaitingPeer[]; onChatOpen: () => void;
}) {
  const [tab, setTab] = useState<"transcript" | "notes" | "actions" | "chat" | "people" | "analyze">("transcript");
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const txBottomRef = useRef<HTMLDivElement>(null);
  const inviteLink = typeof window !== "undefined" ? `${window.location.origin}/meeting-invite/${roomCode}` : "";
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => { if (tab === "transcript") txBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [transcript, tab]);
  useEffect(() => { if (tab === "chat") chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, tab]);
  useEffect(() => { if (tab === "chat") onChatOpen(); }, [tab, onChatOpen]);

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    onSendChat(text);
    setChatInput("");
  };

  const sendEmailInvites = async () => {
    const emails = emailInput.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => e.includes("@"));
    if (emails.length === 0) return;
    setEmailSending(true);
    const res = await fetch("/api/meetings/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode, emails }),
    });
    setEmailSending(false);
    if (res.ok) {
      setEmailSent(true);
      setEmailInput("");
    }
    setTimeout(() => setEmailSent(false), 3000);
  };

  return (
    <div className="flex flex-col h-full border-l border-[var(--line)] bg-[var(--surface-1)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--fg-primary)]">✨ Copilot</span>
          {isUpdating && <span className="text-xs text-[var(--gold-400)] animate-pulse">Updating…</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {srStatus === "active" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-success)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-pulse" /> Live
            </span>
          )}
          {srStatus === "error" && <span className="text-xs text-[var(--status-danger)]">⚠ Mic</span>}
          {srStatus === "unsupported" && <span className="text-xs text-[var(--fg-muted)]">No STT</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--line)] shrink-0 overflow-x-auto">
        {(["transcript", "notes", "actions", "chat", "people", "analyze"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 flex-1 py-2 text-xs font-medium transition-colors capitalize ${
              tab === t ? "text-[var(--fg-primary)] border-b-2 border-[var(--gold-400)] -mb-px"
                        : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
            }`}>
            {t === "people" ? `People ${participants.length}` : t === "chat" ? "Chat" : t === "actions" ? "Actions" : t === "notes" ? "Notes" : t === "analyze" ? "Analyze" : "Live"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {tab === "transcript" && (
          <>
            {transcript.length === 0 ? <EmptyCopilot label="Transcription will appear here once you start speaking." /> : (
              transcript.map((line) => (
                <div key={line.id} className={`text-sm ${line.final ? "text-[var(--fg-primary)]" : "text-[var(--fg-muted)] italic"}`}>
                  {line.speaker && <span className="text-xs font-medium text-[var(--gold-400)] mr-1.5">{line.speaker}:</span>}
                  {line.text}
                </div>
              ))
            )}
            <div ref={txBottomRef} />
          </>
        )}

        {tab === "notes" && (
          <>
            {notes?.summary ? (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 text-sm text-[var(--fg-primary)]">{notes.summary}</div>
            ) : null}
            {notes?.key_points?.length ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">Key Points</p>
                {notes.key_points.map((pt, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--gold-400)] shrink-0" />{pt}
                  </div>
                ))}
              </div>
            ) : (!notes?.summary && <EmptyCopilot label="Key points will appear as your meeting progresses." />)}
          </>
        )}

        {tab === "actions" && (
          notes?.action_items?.length ? (
            <div className="flex flex-col gap-2">
              {notes.action_items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-2.5">
                  <span className="mt-0.5 text-[var(--status-success)]">☐</span>
                  <span className="text-sm text-[var(--fg-primary)]">{item}</span>
                </div>
              ))}
            </div>
          ) : <EmptyCopilot label="Action items will be extracted as you discuss tasks." />
        )}

        {tab === "chat" && (
          <>
            {chatMessages.length === 0 ? <EmptyCopilot label="Send a message to everyone in the call." /> : (
              chatMessages.map((msg) => (
                <div key={msg.id} className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-[var(--gold-400)]">{msg.displayName}</span>
                  <div className="rounded-lg bg-[var(--surface-0)] border border-[var(--line)] px-3 py-2 text-sm text-[var(--fg-primary)]">{msg.text}</div>
                </div>
              ))
            )}
            <div ref={chatBottomRef} />
          </>
        )}

        {tab === "people" && (
          <div className="flex flex-col gap-3">
            {/* Waiting room (host only) */}
            {isHost && waitingPeers.length > 0 && (
              <div className="rounded-lg border border-[var(--gold-400)]/40 bg-[var(--gold-400)]/5 p-3 flex flex-col gap-2">
                <p className="text-xs font-medium text-[var(--gold-400)] uppercase tracking-wide">Waiting to join</p>
                {waitingPeers.map((wp) => (
                  <div key={wp.from} className="flex items-center gap-2">
                    <span className="text-sm text-[var(--fg-primary)] flex-1 truncate">{wp.displayName}</span>
                    <button onClick={() => onAdmit(wp.from)} className="text-xs font-medium text-[var(--status-success)] hover:underline">Admit</button>
                    <button onClick={() => onDeny(wp.from)} className="text-xs font-medium text-[var(--status-danger)] hover:underline">Deny</button>
                  </div>
                ))}
              </div>
            )}

            {/* Invite */}
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 flex flex-col gap-2">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">Invite people</p>
              <button
                onClick={() => { void navigator.clipboard.writeText(inviteLink).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="w-full rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] text-black text-xs font-semibold py-2 transition-colors">
                {copied ? "Link copied!" : "Copy invite link"}
              </button>
              <div className="flex gap-1.5 mt-1">
                <input
                  value={emailInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmailInput(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") void sendEmailInvites(); }}
                  placeholder="Email addresses, comma separated"
                  className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-400)]"
                />
                <button
                  onClick={() => void sendEmailInvites()}
                  disabled={!emailInput.trim() || emailSending}
                  className="rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] text-xs px-2.5 py-1.5 transition-colors disabled:opacity-40"
                >
                  {emailSent ? "Sent!" : emailSending ? "…" : "Send"}
                </button>
              </div>
              <p className="text-[10px] text-[var(--fg-muted)]">Guests can join without an account</p>
            </div>

            {/* Participant list */}
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide px-1">In this call</p>
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                  <div className="w-7 h-7 rounded-full bg-[var(--gold-400)]/20 border border-[var(--gold-400)]/30 flex items-center justify-center text-xs font-semibold text-[var(--gold-400)]">
                    {p.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="text-sm text-[var(--fg-primary)] flex-1">{p.displayName}</span>
                  {raisedHands.has(p.id) && <span className="text-sm">✋</span>}
                  {p.id === "local" ? (
                    <span className="text-xs text-[var(--fg-muted)]">You</span>
                  ) : isHost ? (
                    <button onClick={() => onKick(p.id)} className="text-xs text-[var(--status-danger)] hover:underline">Remove</button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "analyze" && <MeetingCopilotConsole />}
      </div>

      {/* Chat input */}
      {tab === "chat" && (
        <div className="border-t border-[var(--line)] p-3 flex gap-2 shrink-0">
          <input value={chatInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChatInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            placeholder="Message everyone…"
            className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]" />
          <button onClick={sendChat} disabled={!chatInput.trim()}
            className="rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-40 text-black text-xs font-semibold px-3 py-2 transition-colors">
            Send
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyCopilot({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center py-8">
      <p className="text-xs text-[var(--fg-muted)] text-center max-w-40">{label}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MeetingRoom({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  // Memoized so effects that subscribe/query with it can list it as a stable
  // dependency without tearing down and recreating on every render.
  const supabase = useMemo(() => createClient(), []);

  // Local media
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [shareOn, setShareOn] = useState(false);
  const [localName, setLocalName] = useState("You");
  const localNameRef = useRef("You");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const isHostRef = useRef(false);

  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE);

  // Peers
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const peersDataRef = useRef<Map<string, Peer>>(new Map());
  const myIdRef = useRef<string>(crypto.randomUUID());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Transcript
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const recognitionRef = useRef<any>(null);
  const interimIdRef = useRef<string>(crypto.randomUUID());

  // Notes
  const [notes, setNotes] = useState<LiveNotesResult | null>(null);
  const [isUpdatingNotes, startNotesTransition] = useTransition();
  const [srStatus, setSrStatus] = useState<"idle" | "active" | "error" | "unsupported">("idle");
  const notesInflightRef = useRef(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const chatOpenRef = useRef(false);

  // Raise hand & reactions
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Record<string, string>>({});

  // Waiting room
  const [waitingPeers, setWaitingPeers] = useState<WaitingPeer[]>([]);

  // Layout
  const [layout, setLayout] = useState<"grid" | "speaker">("grid");
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  // Bandwidth adaptation
  const [bwMode, setBwMode] = useState<"normal" | "degraded" | "audio-only">("normal");
  const bwCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Media error (permission denial, no devices, etc.)
  const [mediaError, setMediaError] = useState<string | null>(null);

  // UI
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [endError, setEndError] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);

  // Pre-join devices
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedCamId, setSelectedCamId] = useState("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("");

  // Waiting room state
  const [waitingForAdmit, setWaitingForAdmit] = useState(false);
  const [waitingTimedOut, setWaitingTimedOut] = useState(false);
  const waitingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearWaitingTimers = useCallback(() => {
    if (waitingTimerRef.current !== null) {
      clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
    if (waitingPollRef.current !== null) {
      clearInterval(waitingPollRef.current);
      waitingPollRef.current = null;
    }
  }, []);

  const sendSignal = useCallback((msg: SignalMsg) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload: msg });
  }, []);

  const sendSignalRef = useRef(sendSignal);
  useEffect(() => { sendSignalRef.current = sendSignal; }, [sendSignal]);
  useEffect(() => { localNameRef.current = localName; }, [localName]);
  useEffect(() => { peersDataRef.current = peers; }, [peers]);

  // ── createPeerConnection ─────────────────────────────────────────────────

  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(iceConfigRef.current);

    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));

    pc.ontrack = (ev) => {
      const stream: MediaStream | null = ev.streams[0] ?? null;
      setPeers((prev) => {
        const next = new Map<string, Peer>(prev);
        const existing = next.get(peerId);
        next.set(peerId, { id: peerId, displayName: existing?.displayName ?? peerId, stream });
        return next;
      });
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendSignalRef.current({ type: "ice", from: myIdRef.current, to: peerId, candidate: ev.candidate.toJSON() });
    };

    // Auto-restart ICE on failure
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce(); } catch { /* ignore */ }
      }
    };

    peersRef.current.set(peerId, pc);
    return pc;
  }, []);

  // ── handleSignal ─────────────────────────────────────────────────────────

  const handleSignal = useCallback(async (msg: SignalMsg) => {
    const myId = myIdRef.current;

    if (msg.type === "join" && msg.from !== myId) {
      playChime("join");
      setPeers((prev) => {
        const next = new Map<string, Peer>(prev);
        const existing = next.get(msg.from);
        next.set(msg.from, { id: msg.from, displayName: msg.displayName, stream: existing?.stream ?? null });
        return next;
      });
      const pc = createPeerConnection(msg.from);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignalRef.current({ type: "offer", from: myId, to: msg.from, sdp: offer });
      } catch (e) { console.warn("[WebRTC] offer", e); }
    }

    if (msg.type === "end") {
      clearWaitingTimers();
      peersRef.current.forEach((pc) => pc.close()); peersRef.current.clear();
      channelRef.current?.unsubscribe();
      if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      router.push("/meetings");
      return;
    }

    if (msg.type === "leave" && msg.from !== myId) {
      playChime("leave");
      peersRef.current.get(msg.from)?.close();
      peersRef.current.delete(msg.from);
      setPeers((prev) => { const next = new Map<string, Peer>(prev); next.delete(msg.from); return next; });
    }

    if (msg.type === "offer" && msg.to === myId) {
      let pc = peersRef.current.get(msg.from);
      if (!pc) pc = createPeerConnection(msg.from);
      try {
        await pc.setRemoteDescription(msg.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignalRef.current({ type: "answer", from: myId, to: msg.from, sdp: answer });
      } catch (e) { console.warn("[WebRTC] answer", e); }
    }

    if (msg.type === "answer" && msg.to === myId) {
      const pc = peersRef.current.get(msg.from);
      if (pc) { try { await pc.setRemoteDescription(msg.sdp); } catch (e) { console.warn("[WebRTC] setRemote", e); } }
    }

    if (msg.type === "ice" && msg.to === myId) {
      const pc = peersRef.current.get(msg.from);
      if (pc) { try { await pc.addIceCandidate(msg.candidate); } catch { /* safe to ignore */ } }
    }

    if (msg.type === "transcript" && msg.from !== myId) {
      const line: TranscriptLine = { id: crypto.randomUUID(), speaker: msg.speaker, text: msg.text, ts: msg.ts, final: true };
      setTranscript((prev) => { const next = [...prev, line]; transcriptRef.current = next; return next; });
    }

    if (msg.type === "chat" && msg.from !== myId) {
      const chatMsg: ChatMessage = { id: crypto.randomUUID(), from: msg.from, displayName: msg.displayName, text: msg.text, ts: msg.ts };
      setChatMessages((prev) => [...prev, chatMsg]);
      if (!chatOpenRef.current) setChatUnread((n) => n + 1);
    }

    if (msg.type === "raise_hand") {
      setRaisedHands((prev) => { const next = new Set(prev); if (msg.raised) next.add(msg.from); else next.delete(msg.from); return next; });
    }

    if (msg.type === "reaction" && msg.from !== myId) {
      const { emoji } = msg;
      setReactions((prev) => ({ ...prev, [msg.from]: emoji }));
      setTimeout(() => setReactions((prev) => { const n = { ...prev }; if (n[msg.from] === emoji) delete n[msg.from]; return n; }), 3000);
    }

    if (msg.type === "mute_all" && msg.from !== myId) {
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      setMicOn(false);
    }

    if (msg.type === "kick" && msg.target === myId) {
      sendSignalRef.current({ type: "leave", from: myId });
      peersRef.current.forEach((pc) => pc.close()); peersRef.current.clear();
      channelRef.current?.unsubscribe();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      router.push("/meetings");
      return;
    }

    if (msg.type === "admit_request" && isHostRef.current) {
      setWaitingPeers((prev) => prev.some((w) => w.from === msg.from) ? prev : [...prev, { from: msg.from, displayName: msg.displayName }]);
    }

    if (msg.type === "admit" && msg.target === myId) {
      clearWaitingTimers();
      setWaitingForAdmit(false);
      setWaitingTimedOut(false);
      setReady(true);
      sendSignalRef.current({ type: "join", from: myId, displayName: localNameRef.current });
    }

    if (msg.type === "deny" && msg.target === myId) {
      clearWaitingTimers();
      setWaitingForAdmit(false);
      channelRef.current?.unsubscribe();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      router.push("/meetings");
    }
  }, [createPeerConnection, router, clearWaitingTimers]);

  // ── Detect host status on mount (pre-join screen label) ──────────────────

  useEffect(() => {
    async function detectHost() {
      const [{ data: { user } }, { data: meeting }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("live_meetings").select("host_id").eq("room_code", roomCode).maybeSingle(),
      ]);
      const m = meeting as { host_id: string } | null;
      if (user && m && user.id === m.host_id) {
        setIsHost(true);
        isHostRef.current = true;
      }
    }
    void detectHost();
  }, [roomCode, supabase]);

  // ── Preview camera ────────────────────────────────────────────────────────

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(async (s) => {
        previewStreamRef.current = s; setPreviewStream(s);
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all);
        setSelectedCamId(s.getVideoTracks()[0]?.getSettings().deviceId ?? "");
        setSelectedMicId(s.getAudioTracks()[0]?.getSettings().deviceId ?? "");
      }).catch(() => {});
    return () => { previewStreamRef.current?.getTracks().forEach((t) => t.stop()); previewStreamRef.current = null; };
  }, []);

  // ── joinMeeting ──────────────────────────────────────────────────────────

  const joinMeeting = useCallback(async () => {
    setJoining(true);
    const name = displayName.trim() || "Participant";
    setLocalName(name);
    localNameRef.current = name;

    try {
      const r = await fetch("/api/meetings/ice-servers");
      if (r.ok) { const { iceServers } = await r.json() as { iceServers: RTCIceServer[] }; iceConfigRef.current = { iceServers }; }
    } catch { /* keep fallback */ }

    let mId: string | null = null;
    let hostFlag = false;
    try {
      const { data: existing } = await supabase.from("live_meetings").select("id, status, host_id").eq("room_code", roomCode).single();
      const ex = existing as { id: string; status: string; host_id: string } | null;
      if (ex) {
        mId = ex.id;
        if (ex.status === "ended") { router.push(`/meetings/${roomCode}/report`); return; }
        const { data: { user } } = await supabase.auth.getUser();
        hostFlag = !!user && user.id === ex.host_id;
      } else {
        const res = await fetch("/api/meetings/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Meeting", roomCode }) });
        if (res.ok) {
          const d = await res.json() as { id: string; roomCode: string; hostId: string };
          mId = d.id;
          const { data: { user } } = await supabase.auth.getUser();
          hostFlag = !!user && user.id === d.hostId;
        }
      }
    } catch { /* proceed */ }

    setMeetingId(mId); setIsHost(hostFlag); isHostRef.current = hostFlag;

    if (mId) {
      void (supabase.from("live_meetings") as any)
        .update({ started_at: new Date().toISOString() })
        .eq("id", mId)
        .is("started_at", null);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        void supabase.from("live_meeting_participants").upsert(
          { meeting_id: mId, user_id: user.id, display_name: name, joined_at: new Date().toISOString() },
          { onConflict: "meeting_id,user_id" },
        );
      }
    }

    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null; setPreviewStream(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: selectedCamId ? { deviceId: { exact: selectedCamId } } : true,
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setMediaError("Camera and microphone access was denied. Click the camera icon in your browser's address bar to allow access, then rejoin.");
      } else if (name === "NotFoundError") {
        setMediaError("No camera or microphone found. Check that your devices are connected.");
      } else {
        setMediaError("Could not access camera/microphone. Check your device settings.");
      }
      stream = new MediaStream();
    }
    localStreamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
    setLocalStream(stream);

    const channel = supabase.channel(`meeting:${roomCode}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel.on("broadcast", { event: "signal" }, ({ payload }: { payload: SignalMsg }) => { void handleSignal(payload); })
      .subscribe(() => {
        if (hostFlag) {
          sendSignal({ type: "join", from: myIdRef.current, displayName: name });
        } else {
          setWaitingForAdmit(true);
          sendSignal({ type: "admit_request", from: myIdRef.current, displayName: name });
        }
      });

    if (hostFlag) {
      setReady(true);
    } else {
      // Non-host enters the waiting room
      // 2-minute timeout
      waitingTimerRef.current = setTimeout(() => {
        setWaitingTimedOut(true);
      }, 120_000);

      // Poll every 10s for meeting ended
      const currentMId = mId;
      waitingPollRef.current = setInterval(async () => {
        if (!currentMId) return;
        try {
          const { data } = await supabase
            .from("live_meetings")
            .select("status")
            .eq("id", currentMId)
            .single();
          const row = data as { status: string } | null;
          if (row?.status === "ended") {
            clearWaitingTimers();
            router.push(`/meetings/${roomCode}/report`);
          }
        } catch { /* ignore */ }
      }, 10_000);
    }

    setJoining(false);
  }, [displayName, roomCode, supabase, handleSignal, sendSignal, clearWaitingTimers, router, selectedCamId, selectedMicId]);

  // Apply selected speaker on join
  useEffect(() => {
    if (!ready || !selectedSpeakerId) return;
    const videos = document.querySelectorAll("video");
    for (const v of Array.from(videos)) { const el = v as any; if (typeof el.setSinkId === "function") void el.setSinkId(selectedSpeakerId); }
  }, [ready, selectedSpeakerId]);

  // ── Duration timer ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready || waitingForAdmit) return;
    const t = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(t);
  }, [ready, waitingForAdmit]);

  // ── Speech recognition ────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready || waitingForAdmit) return;
    const w = window as any;
    const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => any) | undefined;
    if (!SR) { setSrStatus("unsupported"); return; }
    const recognition = new SR();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onstart = () => setSrStatus("active");
    recognition.onresult = (ev: any) => {
      let interim = ""; let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setTranscript((prev) => {
        const next = [...prev.filter((l) => l.final)];
        if (finalText.trim()) {
          const ts = Date.now();
          next.push({ id: crypto.randomUUID(), speaker: localName, text: finalText.trim(), ts, final: true });
          interimIdRef.current = crypto.randomUUID();
          sendSignalRef.current({ type: "transcript", from: myIdRef.current, speaker: localName, text: finalText.trim(), ts });
        }
        if (interim) next.push({ id: interimIdRef.current, speaker: localName, text: interim, ts: Date.now(), final: false });
        transcriptRef.current = next;
        return next;
      });
    };
    recognition.onerror = (ev: any) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") setSrStatus("error");
      else if (ev.error !== "no-speech") console.warn("[SR]", ev.error);
    };
    recognition.onend = () => {
      setSrStatus((prev) => {
        if (prev === "error" || prev === "unsupported") return prev;
        try { recognition.start(); } catch { /* ignore */ }
        return "active";
      });
    };
    recognition.start();
    recognitionRef.current = recognition;
    return () => { recognition.onend = null; recognition.stop(); };
  }, [ready, waitingForAdmit, localName]);

  // ── Active speaker detection ──────────────────────────────────────────────

  useEffect(() => {
    if (!ready || layout !== "speaker") return;
    const streams = [
      ...(localStream ? [{ id: "local", stream: localStream }] : []),
      ...[...peersDataRef.current.values()].filter((p) => p.stream).map((p) => ({ id: p.id, stream: p.stream! })),
    ];
    const ctxs: { id: string; analyser: AnalyserNode; ctx: AudioContext }[] = [];
    for (const { id, stream } of streams) {
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        ctxs.push({ id, analyser, ctx });
      } catch { /* ignore */ }
    }
    const interval = setInterval(() => {
      let maxVol = 0; let maxId: string | null = null;
      for (const { id, analyser } of ctxs) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const vol = data.reduce((a, b) => a + b, 0) / data.length;
        if (vol > maxVol && vol > 5) { maxVol = vol; maxId = id; }
      }
      if (maxId) setActiveSpeakerId(maxId);
    }, 500);
    return () => { clearInterval(interval); ctxs.forEach(({ ctx }) => void ctx.close()); };
  }, [ready, layout, localStream, peers]);

  // ── Bandwidth adaptation ──────────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    const CHECK_INTERVAL = 8000;
    const LOW_BW_KBPS = 80;  // kbps threshold to downgrade
    const OK_BW_KBPS = 200;  // kbps threshold to restore

    let prevBytes: Record<string, number> = {};
    let prevTs = Date.now();

    const check = async () => {
      const pcs = [...peersRef.current.values()];
      if (!pcs.length) return;

      let totalBps = 0;
      const now = Date.now();
      const elapsed = (now - prevTs) / 1000;
      prevTs = now;

      for (const pc of pcs) {
        try {
          const stats = await pc.getStats();
          stats.forEach((s) => {
            if (s.type === "inbound-rtp" && "bytesReceived" in s) {
              const id = s.id as string;
              const bytes = s.bytesReceived as number;
              if (prevBytes[id] !== undefined) totalBps += (bytes - prevBytes[id]) / elapsed;
              prevBytes[id] = bytes;
            }
          });
        } catch { /* ignore */ }
      }

      const kbps = (totalBps * 8) / 1000;
      setBwMode((prev) => {
        if (kbps > 0 && kbps < LOW_BW_KBPS) {
          // Disable outgoing video to save bandwidth
          if (prev === "normal") {
            localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = false; });
            return "audio-only";
          }
          return prev;
        }
        if (kbps >= OK_BW_KBPS && prev !== "normal") {
          localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = true; });
          return "normal";
        }
        return prev;
      });
    };

    bwCheckRef.current = setInterval(() => { void check(); }, CHECK_INTERVAL);
    return () => { if (bwCheckRef.current) clearInterval(bwCheckRef.current); };
  }, [ready]);

  // ── Notes ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready || waitingForAdmit) return;
    const interval = setInterval(() => {
      if (notesInflightRef.current) return;
      const text = transcriptRef.current.filter((l) => l.final).map((l) => `${l.speaker}: ${l.text}`).join("\n");
      if (!text) return;
      notesInflightRef.current = true;
      startNotesTransition(async () => {
        try {
          const res = await fetch("/api/meetings/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text }) });
          if (res.ok) {
            const result = await res.json() as LiveNotesResult;
            setNotes(result);
            // TODO: persist live notes snapshot once a notes_snapshot column is added to live_meetings
            // (the field does not exist in the DB schema — writing to it silently fails via `as any`)
          }
        } catch { /* ignore */ } finally { notesInflightRef.current = false; }
      });
    }, NOTES_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ready, waitingForAdmit, meetingId]);

  // ── Transcript flush ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready || !meetingId || waitingForAdmit) return;
    const lastFlushed = { idx: 0 };
    const interval = setInterval(() => {
      const finalLines = transcriptRef.current.filter((l) => l.final);
      const newLines = finalLines.slice(lastFlushed.idx);
      if (!newLines.length) return;
      lastFlushed.idx = finalLines.length;
      void (supabase.from("live_meeting_transcripts") as any).insert(
        newLines.map((l) => ({ meeting_id: meetingId, speaker: l.speaker, text: l.text, ts: new Date(l.ts).toISOString() })),
      );
    }, TRANSCRIPT_FLUSH_MS);
    return () => clearInterval(interval);
  }, [ready, meetingId, waitingForAdmit, supabase]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setMicOn((v) => !v);
  }, []);

  const toggleCam = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setCamOn((v) => !v);
  }, []);

  const toggleScreen = useCallback(async () => {
    if (shareOn) {
      const camTrack = cameraTrackRef.current;
      if (camTrack && localStreamRef.current) {
        peersRef.current.forEach((pc) => { const s = pc.getSenders().find((s) => s.track?.kind === "video"); if (s) void s.replaceTrack(camTrack); });
        const stream = localStreamRef.current;
        stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
        stream.addTrack(camTrack);
        setLocalStream(new MediaStream(stream.getTracks()));
      }
      setShareOn(false);
      return;
    }
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack || !localStreamRef.current) return;
      peersRef.current.forEach((pc) => { const s = pc.getSenders().find((s) => s.track?.kind === "video"); if (s) void s.replaceTrack(screenTrack); });
      const stream = localStreamRef.current;
      stream.getVideoTracks().forEach((t) => { stream.removeTrack(t); });
      stream.addTrack(screenTrack);
      setLocalStream(new MediaStream(stream.getTracks()));
      setShareOn(true);
      screenTrack.onended = () => void toggleScreen();
    } catch { /* user cancelled */ }
  }, [shareOn]);

  const switchMic = useCallback(async (deviceId: string) => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
      const t = s.getAudioTracks()[0];
      if (!t || !localStreamRef.current) return;
      peersRef.current.forEach((pc) => { const sender = pc.getSenders().find((s) => s.track?.kind === "audio"); if (sender) void sender.replaceTrack(t); });
      localStreamRef.current.getAudioTracks().forEach((t2) => { t2.stop(); localStreamRef.current!.removeTrack(t2); });
      localStreamRef.current.addTrack(t);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    } catch (e) { console.warn("[switchMic]", e); }
  }, []);

  const switchCam = useCallback(async (deviceId: string) => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
      const t = s.getVideoTracks()[0];
      if (!t || !localStreamRef.current) return;
      cameraTrackRef.current = t;
      peersRef.current.forEach((pc) => { const sender = pc.getSenders().find((s) => s.track?.kind === "video"); if (sender) void sender.replaceTrack(t); });
      localStreamRef.current.getVideoTracks().forEach((t2) => { t2.stop(); localStreamRef.current!.removeTrack(t2); });
      localStreamRef.current.addTrack(t);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    } catch (e) { console.warn("[switchCam]", e); }
  }, []);

  const switchSpeaker = useCallback(async (deviceId: string) => {
    const videos = document.querySelectorAll("video");
    for (const v of Array.from(videos)) { const el = v as any; if (typeof el.setSinkId === "function") try { await el.setSinkId(deviceId); } catch { /* ignore */ } }
  }, []);

  const toggleRaiseHand = useCallback(() => {
    setHandRaised((prev) => {
      const next = !prev;
      sendSignalRef.current({ type: "raise_hand", from: myIdRef.current, raised: next });
      return next;
    });
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    sendSignalRef.current({ type: "reaction", from: myIdRef.current, emoji, ts: Date.now() });
    setReactions((prev) => ({ ...prev, local: emoji }));
    setTimeout(() => setReactions((prev) => { const n = { ...prev }; if (n.local === emoji) delete n.local; return n; }), 3000);
  }, []);

  const sendChat = useCallback((text: string) => {
    const msg: ChatMessage = { id: crypto.randomUUID(), from: myIdRef.current, displayName: localName, text, ts: Date.now() };
    setChatMessages((prev) => [...prev, msg]);
    sendSignal({ type: "chat", from: myIdRef.current, displayName: localName, text, ts: msg.ts });
  }, [localName, sendSignal]);

  const muteAll = useCallback(() => { sendSignal({ type: "mute_all", from: myIdRef.current }); }, [sendSignal]);

  const kickPeer = useCallback((peerId: string) => {
    sendSignal({ type: "kick", from: myIdRef.current, target: peerId });
    peersRef.current.get(peerId)?.close(); peersRef.current.delete(peerId);
    setPeers((prev) => { const next = new Map(prev); next.delete(peerId); return next; });
  }, [sendSignal]);

  const admitPeer = useCallback((peerId: string) => {
    sendSignal({ type: "admit", from: myIdRef.current, target: peerId });
    setWaitingPeers((prev) => prev.filter((w) => w.from !== peerId));
  }, [sendSignal]);

  const denyPeer = useCallback((peerId: string) => {
    sendSignal({ type: "deny", from: myIdRef.current, target: peerId });
    setWaitingPeers((prev) => prev.filter((w) => w.from !== peerId));
  }, [sendSignal]);

  const leaveMeeting = useCallback(() => {
    clearWaitingTimers();
    sendSignal({ type: "leave", from: myIdRef.current });
    peersRef.current.forEach((pc) => pc.close()); peersRef.current.clear();
    channelRef.current?.unsubscribe();
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    router.push("/meetings");
  }, [sendSignal, clearWaitingTimers, router]);

  const endMeeting = useCallback(async () => {
    sendSignal({ type: "end", from: myIdRef.current });
    peersRef.current.forEach((pc) => pc.close()); peersRef.current.clear();
    channelRef.current?.unsubscribe();
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (meetingId) {
      const fullText = transcriptRef.current.filter((l) => l.final).map((l) => `${l.speaker}: ${l.text}`).join("\n");
      try {
        const res = await fetch("/api/meetings/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetingId, transcript: fullText, duration }) });
        if (res.ok) { router.push(`/meetings/${roomCode}/report`); return; }
      } catch { setEndError(true); return; }
    }
    router.push("/meetings");
  }, [sendSignal, meetingId, duration, roomCode, router, setEndError]);

  const endForAll = useCallback(async () => {
    await endMeeting();
  }, [endMeeting]);

  // ── Waiting room screen ─────────────────────────────────────────────────

  if (waitingForAdmit) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 px-4 text-center">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          {waitingTimedOut ? (
            <>
              <div className="w-14 h-14 rounded-full bg-[var(--status-warning)]/15 flex items-center justify-center text-2xl">
                ⏱
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-base font-semibold text-[var(--fg-primary)]">
                  The host hasn&apos;t responded.
                </p>
                <p className="text-sm text-[var(--fg-muted)]">
                  You can try again or leave the meeting.
                </p>
              </div>
              <button
                onClick={leaveMeeting}
                className="rounded-lg bg-[var(--status-danger)] hover:bg-red-600 text-white text-sm font-semibold px-6 py-2.5 transition-colors"
              >
                Leave
              </button>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-[var(--gold-400)]/15 flex items-center justify-center">
                <span className="animate-pulse text-2xl">🔔</span>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-base font-semibold text-[var(--fg-primary)]">
                  Waiting for host to admit you…
                </p>
                <p className="text-sm text-[var(--fg-muted)]">
                  The host will let you in shortly.
                </p>
              </div>
              <button
                onClick={leaveMeeting}
                className="rounded-lg border border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] text-sm px-5 py-2 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Pre-join screen ───────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-5 px-4">
        <div className="w-full max-w-sm flex flex-col gap-3">
          {/* Camera preview */}
          <div className="rounded-2xl overflow-hidden bg-black aspect-video border border-[var(--line)] shadow-sm">
            {previewStream ? <PreviewVideo stream={previewStream} /> : (
              <div className="flex items-center justify-center h-full">
                <span className="text-xs text-[var(--fg-muted)]">Camera off</span>
              </div>
            )}
          </div>

          {/* Join card */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] overflow-hidden">
            <div className="px-5 pt-5 pb-4 flex flex-col gap-4">
              <p className="text-base font-semibold text-[var(--fg-primary)]">{isHost ? "Ready to start?" : "Ready to join?"}</p>

              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
              />

              {devices.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[var(--fg-muted)]">Devices</p>
                  {devices.some((d) => d.kind === "videoinput") && (
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--fg-muted)] shrink-0"><CamIcon /></span>
                      <select value={selectedCamId}
                        onChange={(e) => {
                          setSelectedCamId(e.target.value);
                          previewStreamRef.current?.getTracks().forEach((t) => t.stop());
                          void navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: e.target.value } }, audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true })
                            .then((s) => { previewStreamRef.current = s; setPreviewStream(s); }).catch(() => {});
                        }}
                        className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] truncate">
                        {devices.filter((d) => d.kind === "videoinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>)}
                      </select>
                    </div>
                  )}
                  {devices.some((d) => d.kind === "audioinput") && (
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--fg-muted)] shrink-0"><MicIcon /></span>
                      <select value={selectedMicId} onChange={(e) => setSelectedMicId(e.target.value)}
                        className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] truncate">
                        {devices.filter((d) => d.kind === "audioinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
                      </select>
                    </div>
                  )}
                  {devices.some((d) => d.kind === "audiooutput") && (
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--fg-muted)] shrink-0"><SpeakerIcon /></span>
                      <select value={selectedSpeakerId} onChange={(e) => setSelectedSpeakerId(e.target.value)}
                        className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] truncate">
                        {devices.filter((d) => d.kind === "audiooutput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer row */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--line)] bg-[var(--surface-0)]">
              <span className="font-mono text-xs text-[var(--fg-muted)] bg-[var(--surface-2)] rounded-md px-2 py-1 select-all">{roomCode}</span>
              <button
                onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/meetings/${roomCode}`)}
                className="text-xs text-[var(--gold-400)] hover:text-[var(--gold-500)] transition-colors"
              >
                Copy invite link
              </button>
            </div>

            <div className="px-5 pb-5 pt-3">
              <button
                onClick={() => void joinMeeting()}
                disabled={joining}
                className="w-full rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-50 text-black text-sm font-semibold py-2.5 transition-colors"
              >
                {joining ? (isHost ? "Starting…" : "Joining…") : (isHost ? "Start meeting" : "Join meeting")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Waiting for host to admit ─────────────────────────────────────────────

  if (waitingForAdmit) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--surface-0)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-xs">
          <div className="w-16 h-16 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-3xl animate-pulse">🕐</div>
          <p className="text-base font-medium text-[var(--fg-primary)]">Waiting for the host to admit you</p>
          <p className="text-sm text-[var(--fg-muted)]">The host will let you in soon</p>
          <button onClick={leaveMeeting} className="text-xs text-[var(--status-danger)] hover:underline mt-2">Cancel</button>
        </div>
      </div>
    );
  }

  // ── Active meeting ────────────────────────────────────────────────────────

  const allPeers = [...peers.values()] as Peer[];
  const totalCount = 1 + allPeers.length;
  const gridClass = totalCount === 1 ? "grid-cols-1" : totalCount === 2 ? "grid-cols-2" : totalCount <= 4 ? "grid-cols-2" : "grid-cols-3";

  const participantList = [
    { id: "local", displayName: localName },
    ...allPeers.map((p) => ({ id: p.id, displayName: p.displayName })),
  ];

  const getReaction = (id: string) => reactions[id] ?? "";
  const isHandRaised = (id: string) => id === "local" ? handRaised : raisedHands.has(id);

  // Speaker view helpers
  const speakerTileId = activeSpeakerId ?? "local";
  const speakerIsLocal = speakerTileId === "local";
  const speakerPeer = speakerIsLocal ? null : allPeers.find((p) => p.id === speakerTileId);
  const stripItems: { id: string; displayName: string; stream: MediaStream | null; isLocal: boolean }[] = speakerIsLocal
    ? allPeers.map((p) => ({ id: p.id, displayName: p.displayName, stream: p.stream, isLocal: false }))
    : [{ id: "local", displayName: localName, stream: localStream, isLocal: true }, ...allPeers.filter((p) => p.id !== speakerTileId).map((p) => ({ id: p.id, displayName: p.displayName, stream: p.stream, isLocal: false }))];

  return (
    <div className="fixed inset-0 z-50 bg-[var(--surface-0)] flex flex-col">
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Video area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--surface-0)] min-w-0">
          {/* Media permission warning */}
          {mediaError && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border-b border-amber-500/30 shrink-0">
              <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
              <p className="flex-1 text-sm text-amber-600 dark:text-amber-400">{mediaError}</p>
              <button onClick={() => setMediaError(null)} className="shrink-0 text-amber-500 hover:text-amber-600 text-xs font-medium underline">Dismiss</button>
            </div>
          )}
          {layout === "grid" ? (
            <div className={`flex-1 grid ${gridClass} gap-3 p-4 content-center`}>
              <VideoTile stream={localStream} label={localName} muted isLocal handRaised={handRaised} reaction={getReaction("local")} />
              {allPeers.map((peer: Peer) => (
                <VideoTile key={peer.id} stream={peer.stream} label={peer.displayName} handRaised={raisedHands.has(peer.id)} reaction={reactions[peer.id] ?? ""} />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-2 p-4 overflow-hidden min-h-0">
              {/* Main speaker tile */}
              <div className="flex-1 min-h-0">
                {speakerIsLocal ? (
                  <VideoTile stream={localStream} label={localName} muted isLocal handRaised={handRaised} reaction={getReaction("local")} large />
                ) : speakerPeer ? (
                  <VideoTile stream={speakerPeer.stream} label={speakerPeer.displayName} handRaised={isHandRaised(speakerPeer.id)} reaction={getReaction(speakerPeer.id)} large />
                ) : (
                  <VideoTile stream={localStream} label={localName} muted isLocal handRaised={handRaised} reaction={getReaction("local")} large />
                )}
              </div>
              {/* Thumbnail strip */}
              {stripItems.length > 0 && (
                <div className="flex gap-2 h-24 shrink-0 overflow-x-auto">
                  {stripItems.map((item) => (
                    <div key={item.id} className="h-full aspect-video shrink-0">
                      <VideoTile stream={item.stream} label={item.displayName} muted={item.isLocal} isLocal={item.isLocal} handRaised={isHandRaised(item.id)} reaction={getReaction(item.id)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Copilot sidebar */}
        {copilotOpen && (
          <div className="w-80 shrink-0 flex flex-col overflow-hidden">
            <CopilotSidebar
              transcript={transcript} notes={notes} isUpdating={isUpdatingNotes}
              srStatus={srStatus} participants={participantList} roomCode={roomCode}
              chatMessages={chatMessages} onSendChat={sendChat} isHost={isHost}
              raisedHands={raisedHands} onKick={kickPeer} onAdmit={admitPeer} onDeny={denyPeer}
              waitingPeers={waitingPeers}
              onChatOpen={() => { chatOpenRef.current = true; setChatUnread(0); }}
            />
          </div>
        )}
      </div>

      <ControlBar
        micOn={micOn} camOn={camOn} shareOn={shareOn} copilotOpen={copilotOpen}
        isHost={isHost} handRaised={handRaised} layout={layout} chatUnread={chatUnread} duration={duration}
        roomCode={roomCode} bwMode={bwMode}
        onToggleMic={toggleMic} onToggleCam={toggleCam}
        onToggleScreen={() => void toggleScreen()}
        onToggleCopilot={() => { setCopilotOpen((v) => { if (v) chatOpenRef.current = false; return !v; }); }}
        onLeave={leaveMeeting} onEndForAll={() => void endForAll()}
        onSwitchMic={switchMic} onSwitchCam={switchCam} onSwitchSpeaker={switchSpeaker}
        onRaiseHand={toggleRaiseHand} onReaction={sendReaction} onMuteAll={muteAll}
        onToggleLayout={() => setLayout((v) => v === "grid" ? "speaker" : "grid")}
      />

      {/* Report generation error banner */}
      {endError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-2xl border border-[var(--status-danger)]/40 bg-[var(--surface-1)] shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-xl shrink-0">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-[var(--fg-primary)]">Report generation failed</p>
                <p className="text-sm text-[var(--fg-muted)] mt-1">
                  Your transcript is preserved — try ending the meeting again.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setEndError(false); void endForAll(); }}
                className="flex-1 rounded-lg bg-[var(--status-danger)] hover:bg-red-600 text-white text-sm font-semibold py-2 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => router.push("/meetings")}
                className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--fg-primary)] text-sm font-medium py-2 transition-colors"
              >
                Exit anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06A2 2 0 0 1 12 17c-1.1 0-2-.9-2-2V9.13" />
    </svg>
  );
}

function PhoneOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.4 9.6a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 3.51 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.49 8.91" />
      <line x1="23" y1="1" x2="1" y2="23" />
    </svg>
  );
}

function ScreenShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <polyline points="8 21 12 17 16 21" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="14" rx="2" />
      <rect x="2" y="19" width="6" height="3" rx="1" />
      <rect x="9" y="19" width="6" height="3" rx="1" />
      <rect x="16" y="19" width="6" height="3" rx="1" />
    </svg>
  );
}

function GridViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="9" height="9" rx="1" />
      <rect x="13" y="2" width="9" height="9" rx="1" />
      <rect x="2" y="13" width="9" height="9" rx="1" />
      <rect x="13" y="13" width="9" height="9" rx="1" />
    </svg>
  );
}
