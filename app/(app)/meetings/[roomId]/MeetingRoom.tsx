"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { LiveNotesResult } from "@/app/api/meetings/notes/route";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Peer {
  id: string;
  displayName: string;
  stream: MediaStream | null;
}

interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  ts: number;
  final: boolean;
}

type SignalMsg =
  | { type: "join"; from: string; displayName: string }
  | { type: "leave"; from: string }
  | { type: "end"; from: string }
  | { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };

// ─── Constants ───────────────────────────────────────────────────────────────

const FALLBACK_ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const NOTES_INTERVAL_MS = 15_000;
const TRANSCRIPT_FLUSH_MS = 60_000;

// ─── Video tile ──────────────────────────────────────────────────────────────

function VideoTile({
  stream,
  label,
  muted = false,
  isLocal = false,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  isLocal?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideo = stream?.getVideoTracks().some((t) => t.enabled && t.readyState === "live");

  return (
    <div className="relative rounded-2xl overflow-hidden bg-[var(--surface-2)] border border-[var(--line)] aspect-video flex items-center justify-center">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`w-full h-full object-cover ${isLocal ? "scale-x-[-1]" : ""}`}
        />
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
    </div>
  );
}

// ─── Controls bar ────────────────────────────────────────────────────────────

function ControlBar({
  micOn,
  camOn,
  shareOn,
  copilotOpen,
  isHost,
  onToggleMic,
  onToggleCam,
  onToggleScreen,
  onToggleCopilot,
  onLeave,
  onEndForAll,
  duration,
}: {
  micOn: boolean;
  camOn: boolean;
  shareOn: boolean;
  copilotOpen: boolean;
  isHost: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreen: () => void;
  onToggleCopilot: () => void;
  onLeave: () => void;
  onEndForAll: () => void;
  duration: number;
}) {
  const mins = String(Math.floor(duration / 60)).padStart(2, "0");
  const secs = String(duration % 60).padStart(2, "0");

  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--line)] bg-[var(--surface-1)]">
      {/* Timer */}
      <span className="text-xs font-mono text-[var(--fg-muted)] tabular-nums w-16">
        {mins}:{secs}
      </span>

      {/* Core controls */}
      <div className="flex items-center gap-3">
        <CtrlBtn
          active={micOn}
          onClick={onToggleMic}
          title={micOn ? "Mute" : "Unmute"}
          activeIcon={<MicIcon />}
          inactiveIcon={<MicOffIcon />}
        />
        <CtrlBtn
          active={camOn}
          onClick={onToggleCam}
          title={camOn ? "Turn off camera" : "Turn on camera"}
          activeIcon={<CamIcon />}
          inactiveIcon={<CamOffIcon />}
        />
        <CtrlBtn
          active={shareOn}
          onClick={onToggleScreen}
          title={shareOn ? "Stop sharing" : "Share screen"}
          activeIcon={<ScreenShareIcon />}
          inactiveIcon={<ScreenShareIcon />}
        />
        {isHost ? (
          <button
            onClick={onEndForAll}
            className="flex items-center gap-2 rounded-full bg-[var(--status-danger)] hover:bg-red-600 text-white text-sm font-medium px-5 py-2 transition-colors"
            title="End call for everyone"
          >
            <PhoneOffIcon />
            End for all
          </button>
        ) : (
          <button
            onClick={onLeave}
            className="flex items-center gap-2 rounded-full bg-[var(--status-danger)] hover:bg-red-600 text-white text-sm font-medium px-5 py-2 transition-colors"
            title="Leave call"
          >
            <PhoneOffIcon />
            Leave
          </button>
        )}
      </div>

      {/* Copilot toggle */}
      <button
        onClick={onToggleCopilot}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
          copilotOpen
            ? "border-[var(--gold-400)] bg-[var(--gold-400)]/10 text-[var(--gold-400)]"
            : "border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
        }`}
        title="Toggle AI Copilot"
      >
        ✨ Copilot
      </button>
    </div>
  );
}

function CtrlBtn({
  active,
  onClick,
  title,
  activeIcon,
  inactiveIcon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
        active
          ? "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] hover:bg-[var(--surface-3)]"
          : "border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 text-[var(--status-danger)]"
      }`}
    >
      {active ? activeIcon : inactiveIcon}
    </button>
  );
}

// ─── Copilot sidebar ─────────────────────────────────────────────────────────

function CopilotSidebar({
  transcript,
  notes,
  isUpdating,
  srStatus,
  participants,
  roomCode,
}: {
  transcript: TranscriptLine[];
  notes: LiveNotesResult | null;
  isUpdating: boolean;
  srStatus: "idle" | "active" | "error" | "unsupported";
  participants: { id: string; displayName: string }[];
  roomCode: string;
}) {
  const [tab, setTab] = useState<"transcript" | "notes" | "actions" | "people">("transcript");
  const [copied, setCopied] = useState(false);

  const inviteLink = typeof window !== "undefined"
    ? `${window.location.origin}/meetings/${roomCode}`
    : "";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === "transcript") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, tab]);

  return (
    <div className="flex flex-col h-full border-l border-[var(--line)] bg-[var(--surface-1)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--fg-primary)]">✨ Copilot</span>
          {isUpdating && (
            <span className="text-xs text-[var(--gold-400)] animate-pulse">Updating…</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {srStatus === "active" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-success)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-pulse" />
              Live
            </span>
          )}
          {srStatus === "error" && (
            <span className="text-xs text-[var(--status-danger)]" title="Microphone error">⚠ Mic</span>
          )}
          {srStatus === "unsupported" && (
            <span className="text-xs text-[var(--fg-muted)]" title="Browser doesn't support live transcription">No STT</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--line)]">
        {(["transcript", "notes", "actions", "people"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors capitalize ${
              tab === t
                ? "text-[var(--fg-primary)] border-b-2 border-[var(--gold-400)] -mb-px"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
            }`}
          >
            {t === "actions" ? "Actions" : t === "notes" ? "Notes" : t === "people" ? `People ${participants.length}` : "Transcript"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {tab === "transcript" && (
          <>
            {transcript.length === 0 ? (
              <EmptyCopilot label="Transcription will appear here once you start speaking." />
            ) : (
              transcript.map((line) => (
                <div key={line.id} className={`text-sm ${line.final ? "text-[var(--fg-primary)]" : "text-[var(--fg-muted)] italic"}`}>
                  {line.speaker && (
                    <span className="text-xs font-medium text-[var(--gold-400)] mr-1.5">
                      {line.speaker}:
                    </span>
                  )}
                  {line.text}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </>
        )}

        {tab === "notes" && (
          <>
            {notes?.summary ? (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 text-sm text-[var(--fg-primary)]">
                {notes.summary}
              </div>
            ) : null}
            {notes?.key_points?.length ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">Key Points</p>
                {notes.key_points.map((pt, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-[var(--fg-primary)]">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--gold-400)] shrink-0" />
                    {pt}
                  </div>
                ))}
              </div>
            ) : (
              !notes?.summary && <EmptyCopilot label="Key points will appear as your meeting progresses." />
            )}
          </>
        )}

        {tab === "actions" && (
          <>
            {notes?.action_items?.length ? (
              <div className="flex flex-col gap-2">
                {notes.action_items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-2.5">
                    <span className="mt-0.5 text-[var(--status-success)]">☐</span>
                    <span className="text-sm text-[var(--fg-primary)]">{item}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyCopilot label="Action items will be extracted as you discuss tasks." />
            )}
          </>
        )}

        {tab === "people" && (
          <div className="flex flex-col gap-3">
            {/* Invite link */}
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 flex flex-col gap-2">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">Invite link</p>
              <p className="text-xs text-[var(--fg-muted)] font-mono break-all">{roomCode}</p>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(inviteLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="w-full rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] text-black text-xs font-semibold py-2 transition-colors"
              >
                {copied ? "Copied!" : "Copy invite link"}
              </button>
            </div>

            {/* Participant list */}
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide px-1">In this call</p>
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                  <div className="w-7 h-7 rounded-full bg-[var(--gold-400)]/20 border border-[var(--gold-400)]/30 flex items-center justify-center text-xs font-semibold text-[var(--gold-400)]">
                    {p.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="text-sm text-[var(--fg-primary)]">{p.displayName}</span>
                  {p.id === "local" && <span className="ml-auto text-xs text-[var(--fg-muted)]">You</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
  const supabase = createClient();

  // Local media
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [shareOn, setShareOn] = useState(false);
  const [localName, setLocalName] = useState("You");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);

  // ICE configuration (fetched once from server)
  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE);

  // Peer connections
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const myIdRef = useRef<string>(crypto.randomUUID());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Transcript
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const recognitionRef = useRef<any>(null); // SpeechRecognition not in all TS lib configs
  const interimIdRef = useRef<string>(crypto.randomUUID());

  // Copilot notes
  const [notes, setNotes] = useState<LiveNotesResult | null>(null);
  const [isUpdatingNotes, startNotesTransition] = useTransition();

  // Speech recognition status
  const [srStatus, setSrStatus] = useState<"idle" | "active" | "error" | "unsupported">("idle");

  // UI state
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const notesInflightRef = useRef(false);
  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);

  const sendSignal = useCallback(
    (msg: SignalMsg) => {
      channelRef.current?.send({ type: "broadcast", event: "signal", payload: msg });
    },
    [],
  );

  // ── Peer connection helpers ─────────────────────────────────────────────

  const createPeerConnection = useCallback(
    (peerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection(iceConfigRef.current);

      localStreamRef.current?.getTracks().forEach((t) => {
        pc.addTrack(t, localStreamRef.current!);
      });

      pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        setPeers((prev) => {
          const next = new Map(prev);
          const existing = next.get(peerId);
          next.set(peerId, { ...(existing ?? { id: peerId, displayName: peerId }), stream });
          return next;
        });
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSignal({ type: "ice", from: myIdRef.current, to: peerId, candidate: ev.candidate.toJSON() });
        }
      };

      peersRef.current.set(peerId, pc);
      return pc;
    },
    [sendSignal],
  );

  const handleSignal = useCallback(
    async (msg: SignalMsg) => {
      const myId = myIdRef.current;

      if (msg.type === "join" && msg.from !== myId) {
        // Always update displayName (ontrack may have created a stub entry with the raw UUID)
        setPeers((prev) => {
          const next = new Map(prev);
          const existing = next.get(msg.from);
          next.set(msg.from, { id: msg.from, displayName: msg.displayName, stream: existing?.stream ?? null });
          return next;
        });
        const pc = createPeerConnection(msg.from);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({ type: "offer", from: myId, to: msg.from, sdp: offer });
        } catch (e) {
          console.warn("[WebRTC] offer error", e);
        }
      }

      if (msg.type === "end") {
        // Host ended the call — leave immediately without generating a report
        peersRef.current.forEach((pc) => pc.close());
        peersRef.current.clear();
        channelRef.current?.unsubscribe();
        if (recognitionRef.current) {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        }
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        router.push("/meetings");
        return;
      }

      if (msg.type === "leave" && msg.from !== myId) {
        peersRef.current.get(msg.from)?.close();
        peersRef.current.delete(msg.from);
        setPeers((prev) => {
          const next = new Map(prev);
          next.delete(msg.from);
          return next;
        });
      }

      if (msg.type === "offer" && msg.to === myId) {
        let pc = peersRef.current.get(msg.from);
        if (!pc) pc = createPeerConnection(msg.from);
        try {
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "answer", from: myId, to: msg.from, sdp: answer });
        } catch (e) {
          console.warn("[WebRTC] glare/setRemoteDescription error", e);
        }
      }

      if (msg.type === "answer" && msg.to === myId) {
        const pc = peersRef.current.get(msg.from);
        if (pc) {
          try {
            await pc.setRemoteDescription(msg.sdp);
          } catch (e) {
            console.warn("[WebRTC] answer error", e);
          }
        }
      }

      if (msg.type === "ice" && msg.to === myId) {
        const pc = peersRef.current.get(msg.from);
        if (pc) {
          try {
            await pc.addIceCandidate(msg.candidate);
          } catch { /* candidate arrived before remote description — safe to ignore */ }
        }
      }
    },
    [createPeerConnection, sendSignal],
  );

  // ── Preview camera before joining ──────────────────────────────────────

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        previewStreamRef.current = s;
        setPreviewStream(s);
      })
      .catch(() => {});
    return () => {
      // Use ref so cleanup captures the stream even if it resolved after render
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    };
  }, []);

  // ── Join meeting ────────────────────────────────────────────────────────

  const joinMeeting = useCallback(async () => {
    setJoining(true);
    const name = displayName.trim() || "Participant";
    setLocalName(name);

    // Fetch TURN/STUN ICE servers
    try {
      const iceRes = await fetch("/api/meetings/ice-servers");
      if (iceRes.ok) {
        const { iceServers } = await iceRes.json() as { iceServers: RTCIceServer[] };
        iceConfigRef.current = { iceServers };
      }
    } catch { /* keep fallback */ }

    // Get or create meeting
    let mId: string | null = null;
    try {
      const { data: existingRaw } = await supabase
        .from("live_meetings")
        .select("id, status")
        .eq("room_code", roomCode)
        .single();

      const existing = existingRaw as { id: string; status: string } | null;
      if (existing) {
        mId = existing.id;
        if (existing.status === "ended") {
          router.push(`/meetings/${roomCode}/report`);
          return;
        }
      } else {
        const res = await fetch("/api/meetings/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Meeting" }),
        });
        if (res.ok) {
          const d = await res.json() as { id: string };
          mId = d.id;
          setIsHost(true);
        }
      }
    } catch {
      // Proceed without DB — meeting still works
    }
    setMeetingId(mId);

    // Record participant join
    if (mId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        void (supabase.from("live_meeting_participants") as any).upsert(
          { meeting_id: mId, user_id: user.id, display_name: name, joined_at: new Date().toISOString() },
          { onConflict: "meeting_id,user_id" },
        );
      }
    }

    // Stop preview BEFORE acquiring meeting stream to avoid NotReadableError on mobile
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null;
    setPreviewStream(null);

    // Acquire local media
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      stream = new MediaStream();
    }
    localStreamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
    setLocalStream(stream);

    // Subscribe to signaling channel
    const channel = supabase.channel(`meeting:${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "signal" }, ({ payload }: { payload: SignalMsg }) => {
        void handleSignal(payload);
      })
      .subscribe(() => {
        sendSignal({ type: "join", from: myIdRef.current, displayName: name });
      });

    setReady(true);
    setJoining(false);
  }, [displayName, roomCode, supabase, previewStream, handleSignal, sendSignal, router]);

  // ── Duration timer ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(t);
  }, [ready]);

  // ── Speech recognition ──────────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;

    // eslint-disable-next-line
    const w = window as any;
    const SR = (typeof window !== "undefined"
      ? (w.SpeechRecognition ?? w.webkitSpeechRecognition)
      : undefined) as (new () => any) | undefined;

    if (!SR) {
      setSrStatus("unsupported");
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => setSrStatus("active");

    recognition.onresult = (ev: any) => {
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }

      setTranscript((prev) => {
        const next = [...prev.filter((l) => l.final)];
        if (finalText.trim()) {
          next.push({
            id: crypto.randomUUID(),
            speaker: localName,
            text: finalText.trim(),
            ts: Date.now(),
            final: true,
          });
          interimIdRef.current = crypto.randomUUID();
        }
        if (interim) {
          next.push({
            id: interimIdRef.current,
            speaker: localName,
            text: interim,
            ts: Date.now(),
            final: false,
          });
        }
        transcriptRef.current = next;
        return next;
      });
    };

    recognition.onerror = (ev: any) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setSrStatus("error");
      } else if (ev.error !== "no-speech") {
        console.warn("[SR]", ev.error);
      }
    };

    recognition.onend = () => {
      // Auto-restart unless we hit a hard error
      setSrStatus((prev) => {
        if (prev === "error" || prev === "unsupported") return prev;
        try { recognition.start(); } catch { /* ignore */ }
        return "active";
      });
    };

    recognition.start();
    recognitionRef.current = recognition;

    return () => {
      recognition.onend = null;
      recognition.stop();
    };
  }, [ready, localName]);

  // ── Periodic notes update ───────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => {
      if (notesInflightRef.current) return;
      const text = transcriptRef.current
        .filter((l) => l.final)
        .map((l) => `${l.speaker}: ${l.text}`)
        .join("\n");
      if (!text) return;

      notesInflightRef.current = true;
      startNotesTransition(async () => {
        try {
          const res = await fetch("/api/meetings/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: text }),
          });
          if (res.ok) {
            const result = await res.json() as LiveNotesResult;
            setNotes(result);
            // Persist snapshot to DB so command center can surface it
            if (meetingId) {
              void (supabase.from("live_meetings") as any).update({
                notes_snapshot: result,
              }).eq("id", meetingId);
            }
          }
        } catch { /* silently fail */ } finally {
          notesInflightRef.current = false;
        }
      });
    }, NOTES_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ready, meetingId]);

  // ── Periodic transcript flush to DB ────────────────────────────────────

  useEffect(() => {
    if (!ready || !meetingId) return;
    const lastFlushedRef = { idx: 0 };
    const interval = setInterval(() => {
      const finalLines = transcriptRef.current.filter((l) => l.final);
      const newLines = finalLines.slice(lastFlushedRef.idx);
      if (!newLines.length) return;
      lastFlushedRef.idx = finalLines.length;
      void (supabase.from("live_meeting_transcripts") as any).insert(
        newLines.map((l) => ({
          meeting_id: meetingId,
          speaker: l.speaker,
          text: l.text,
          ts: new Date(l.ts).toISOString(),
        })),
      );
    }, TRANSCRIPT_FLUSH_MS);
    return () => clearInterval(interval);
  }, [ready, meetingId]);

  // ── Controls ────────────────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setMicOn((v) => !v);
  }, []);

  const toggleCam = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setCamOn((v) => !v);
  }, []);

  const toggleScreen = useCallback(async () => {
    if (shareOn) {
      // Revert to camera track
      const camTrack = cameraTrackRef.current;
      if (camTrack && localStreamRef.current) {
        // Replace screen track with camera track in all peer connections
        peersRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) void sender.replaceTrack(camTrack);
        });
        // Swap in the stream
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

      // Replace video track in all peer connections
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) void sender.replaceTrack(screenTrack);
      });

      // Swap in the stream
      const stream = localStreamRef.current;
      stream.getVideoTracks().forEach((t) => { stream.removeTrack(t); });
      stream.addTrack(screenTrack);
      setLocalStream(new MediaStream(stream.getTracks()));
      setShareOn(true);

      // Auto-revert when user stops from browser controls
      screenTrack.onended = () => void toggleScreen();
    } catch { /* user cancelled */ }
  }, [shareOn]);

  const leaveMeeting = useCallback(() => {
    sendSignal({ type: "leave", from: myIdRef.current });
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    channelRef.current?.unsubscribe();
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    router.push("/meetings");
  }, [sendSignal, router]);

  const endMeeting = useCallback(async () => {
    sendSignal({ type: "leave", from: myIdRef.current });

    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    channelRef.current?.unsubscribe();
    // Null onend before stopping to prevent the auto-restart loop
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());

    if (meetingId) {
      const fullText = transcriptRef.current
        .filter((l) => l.final)
        .map((l) => `${l.speaker}: ${l.text}`)
        .join("\n");

      try {
        const res = await fetch("/api/meetings/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingId,
            transcript: fullText,
            duration,
          }),
        });
        if (res.ok) {
          router.push(`/meetings/${roomCode}/report`);
          return;
        }
      } catch { /* fallback */ }
    }

    router.push("/meetings");
  }, [sendSignal, meetingId, duration, roomCode, router]);

  const endForAll = useCallback(async () => {
    sendSignal({ type: "end", from: myIdRef.current });
    await endMeeting();
  }, [sendSignal, endMeeting]);

  // ── Pre-join screen ─────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 px-4">
        <div className="w-full max-w-sm flex flex-col gap-4">
          {/* Camera preview */}
          <div className="rounded-2xl overflow-hidden bg-[var(--surface-2)] aspect-video border border-[var(--line)]">
            {previewStream ? (
              <PreviewVideo stream={previewStream} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <span className="text-xs text-[var(--fg-muted)]">Camera preview</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 flex flex-col gap-3">
            <p className="text-sm font-medium text-[var(--fg-primary)]">Ready to join?</p>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />
            <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <span className="font-mono bg-[var(--surface-2)] rounded px-1.5 py-0.5">{roomCode}</span>
              <span>·</span>
              <button
                onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/meetings/${roomCode}`)}
                className="text-[var(--gold-400)] hover:text-[var(--gold-500)]"
              >
                Copy invite link
              </button>
            </div>
            <button
              onClick={() => void joinMeeting()}
              disabled={joining}
              className="rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-50 text-black text-sm font-semibold py-2.5 transition-colors"
            >
              {joining ? "Joining…" : "Join meeting"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active meeting ──────────────────────────────────────────────────────

  const allPeers = Array.from(peers.values());
  const totalCount = 1 + allPeers.length;

  const gridClass =
    totalCount === 1 ? "grid-cols-1" :
    totalCount === 2 ? "grid-cols-2" :
    totalCount <= 4 ? "grid-cols-2" :
    "grid-cols-3";

  const participantList = [
    { id: "local", displayName: localName },
    ...allPeers.map((p) => ({ id: p.id, displayName: p.displayName })),
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[var(--surface-0)] flex flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--surface-0)]">
          <div className={`flex-1 grid ${gridClass} gap-3 p-4 content-center`}>
            <VideoTile
              stream={localStream}
              label={localName}
              muted
              isLocal
            />
            {allPeers.map((peer) => (
              <VideoTile
                key={peer.id}
                stream={peer.stream}
                label={peer.displayName}
              />
            ))}
          </div>
        </div>

        {/* Copilot sidebar */}
        {copilotOpen && (
          <div className="w-80 shrink-0 flex flex-col overflow-hidden">
            <CopilotSidebar
              transcript={transcript}
              notes={notes}
              isUpdating={isUpdatingNotes}
              srStatus={srStatus}
              participants={participantList}
              roomCode={roomCode}
            />
          </div>
        )}
      </div>

      <ControlBar
        micOn={micOn}
        camOn={camOn}
        shareOn={shareOn}
        copilotOpen={copilotOpen}
        isHost={isHost}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleScreen={() => void toggleScreen()}
        onToggleCopilot={() => setCopilotOpen((v) => !v)}
        onLeave={leaveMeeting}
        onEndForAll={() => void endForAll()}
        duration={duration}
      />
    </div>
  );
}

function PreviewVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover scale-x-[-1]"
    />
  );
}

// ─── SVG Icons ───────────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
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
