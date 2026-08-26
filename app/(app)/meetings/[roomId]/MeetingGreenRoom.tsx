"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEVICE_PREF_KEYS,
  canJoin as canJoinWith,
  constraintsFor,
  devicesOfKind,
  levelBars,
  levelFromSamples,
  pickDevice,
  readinessProblems,
  smoothLevel,
  type Device,
  type DeviceKind,
} from "@/lib/meetings/devices";
import { MeetingShareLink } from "../MeetingShareLink";

/** What the member settled on before pressing Join. */
export interface GreenRoomChoice {
  cameraId: string;
  micId: string;
  speakerId: string;
  cameraEnabled: boolean;
  micEnabled: boolean;
}

export interface MeetingGreenRoomProps {
  roomCode: string;
  isHost: boolean;
  joining: boolean;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  meetingTitle?: string | null;
  scheduledAt?: string | null;
  onJoin: (choice: GreenRoomChoice) => void;
  /** Hands the live preview stream up so the room can release it before it
   *  opens the real sending stream — some platforms will not grant the same
   *  camera twice. */
  onPreviewStream?: (stream: MediaStream | null) => void;
}

/** The remembered choice for a kind, or null in a browser without storage. */
function remembered(kind: DeviceKind): string | null {
  try {
    return window.localStorage.getItem(DEVICE_PREF_KEYS[kind]);
  } catch {
    return null;
  }
}

function remember(kind: DeviceKind, deviceId: string): void {
  try {
    if (deviceId) window.localStorage.setItem(DEVICE_PREF_KEYS[kind], deviceId);
  } catch {
    /* private mode / storage disabled — the picker still works for this call */
  }
}

/** MediaDeviceInfo is a live browser object; this is the plain shape we test against. */
function toDevices(list: MediaDeviceInfo[]): Device[] {
  return list
    .filter((d) => d.kind === "audioinput" || d.kind === "videoinput" || d.kind === "audiooutput")
    .map((d) => ({ deviceId: d.deviceId, kind: d.kind as DeviceKind, label: d.label, groupId: d.groupId }));
}

// How long the meter gets to hear something before we tell someone their
// microphone is dead. Long enough to cover "hasn't spoken yet"; short enough
// that a genuinely muted input is caught before the call starts.
const MIC_SETTLE_MS = 3000;

/** Segmented mic meter — the thing that answers "can they actually hear me?". */
function MicMeter({ level, active, bars = 12 }: { level: number; active: boolean; bars?: number }) {
  const lit = active ? levelBars(level, bars) : 0;
  return (
    <div className="flex items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="w-1 rounded-full transition-[height,background-color] duration-75"
          style={{
            height: 4 + i * 0.9,
            backgroundColor:
              i < lit
                ? i > bars - 3
                  ? "var(--status-danger)"
                  : "var(--gold-400)"
                : "var(--surface-3)",
          }}
        />
      ))}
    </div>
  );
}

function PreviewVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => { /* autoplay race — retried on canplay */ });
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      onCanPlay={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
      className="w-full h-full object-cover scale-x-[-1]"
    />
  );
}

function MicGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {off && <line x1="1" y1="1" x2="23" y2="23" />}
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  );
}

function CamGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {off && <line x1="1" y1="1" x2="23" y2="23" />}
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function SpeakerGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

/**
 * The green room: check yourself before anyone can see or hear you.
 *
 * Nothing here touches signaling or a peer connection. The stream it opens is
 * local-only and is released the moment the room takes over, which is what makes
 * "nobody sees you until you press Join" true rather than merely intended.
 */
export function MeetingGreenRoom({
  roomCode,
  isHost,
  joining,
  displayName,
  onDisplayNameChange,
  meetingTitle,
  scheduledAt,
  onJoin,
  onPreviewStream,
}: MeetingGreenRoomProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [speakerId, setSpeakerId] = useState("");
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const [micSettled, setMicSettled] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const micPeakRef = useRef(0);
  const onPreviewStreamRef = useRef(onPreviewStream);
  useEffect(() => { onPreviewStreamRef.current = onPreviewStream; }, [onPreviewStream]);

  const cameras = useMemo(() => devicesOfKind(devices, "videoinput"), [devices]);
  const mics = useMemo(() => devicesOfKind(devices, "audioinput"), [devices]);
  const speakers = useMemo(() => devicesOfKind(devices, "audiooutput"), [devices]);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(toDevices(all));
    } catch {
      setDevices([]);
    }
  }, []);

  // ── Acquire the preview ──────────────────────────────────────────────────
  //
  // Re-runs whenever the chosen device changes: a picker that changes the label
  // but not the stream is a picker that lies, and the meter would then be
  // metering the wrong microphone.
  useEffect(() => {
    let cancelled = false;

    async function acquire() {
      streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
      streamRef.current = null;

      const wantVideo = cameraEnabled;
      if (!wantVideo && micDenied) {
        setStream(null);
        onPreviewStreamRef.current?.(null);
        return;
      }

      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: wantVideo ? constraintsFor("videoinput", camId || null) : false,
          audio: micDenied ? false : constraintsFor("audioinput", micId || null),
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        onPreviewStreamRef.current?.(s);
        setCameraDenied(false);
        if (!micDenied) setMicDenied(false);

        // Labels only arrive once permission is granted, so the pickers stay
        // anonymous until this point. Re-enumerating here is what fills them in.
        await refreshDevices();
        if (cancelled) return;
        const settings = s.getVideoTracks()[0]?.getSettings();
        if (settings?.deviceId && !camId) setCamId(settings.deviceId);
        const micSettings = s.getAudioTracks()[0]?.getSettings();
        if (micSettings?.deviceId && !micId) setMicId(micSettings.deviceId);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          // The browser does not say which of the two was refused, and asking
          // separately would mean two prompts. Treat a blanket refusal as both,
          // then let the retry below narrow it.
          setCameraDenied(cameraEnabled);
          setMicDenied(true);
        } else if (name === "OverconstrainedError" || name === "NotFoundError") {
          // A remembered device that has since been unplugged. Forget it and
          // fall back rather than leaving the member staring at a black square.
          if (camId) { setCamId(""); return; }
          if (micId) { setMicId(""); return; }
          setCameraDenied(false);
        }
        setStream(null);
        onPreviewStreamRef.current?.(null);
        await refreshDevices();
      }
    }

    void acquire();
    return () => { cancelled = true; };
  }, [camId, micId, cameraEnabled, micDenied, refreshDevices]);

  // Release on unmount. The room stops the same tracks before it opens its own
  // stream, so this is a backstop for leaving the page without joining.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
      streamRef.current = null;
    };
  }, []);

  // A device plugged in or pulled out while someone is sitting here.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { void refreshDevices(); };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  // ── Meter ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || !micEnabled) { setLevel(0); return; }

    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    let raf = 0;
    let smoothed = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      smoothed = smoothLevel(smoothed, levelFromSamples(buffer));
      micPeakRef.current = Math.max(micPeakRef.current, smoothed);
      setLevel(smoothed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const settle = setTimeout(() => setMicSettled(true), MIC_SETTLE_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      try { source.disconnect(); } catch { /* context already torn down */ }
      void ctx.close().catch(() => {});
    };
  }, [stream, micEnabled]);

  // A fresh microphone deserves a fresh verdict.
  useEffect(() => {
    micPeakRef.current = 0;
    setMicSettled(false);
  }, [micId]);

  // ── Remembered choices ───────────────────────────────────────────────────
  useEffect(() => {
    if (devices.length === 0) return;
    setCamId((current) => current || pickDevice(devices, "videoinput", remembered("videoinput"))?.deviceId || "");
    setMicId((current) => current || pickDevice(devices, "audioinput", remembered("audioinput"))?.deviceId || "");
    setSpeakerId((current) => current || pickDevice(devices, "audiooutput", remembered("audiooutput"))?.deviceId || "");
  }, [devices]);

  const problems = readinessProblems({
    cameraDenied,
    micDenied,
    cameras: cameras.length,
    mics: mics.length,
    // Before the meter has had its say, report a level that cannot trip the
    // "silent microphone" warning — otherwise everyone is told their mic is
    // broken for the first three seconds, every time.
    micPeak: micSettled ? micPeakRef.current : 1,
    cameraEnabled,
    micEnabled,
  });
  const joinable = canJoinWith({ micDenied, mics: mics.length });
  const listenOnly = joinable && micDenied;

  const choose = (kind: DeviceKind, deviceId: string) => {
    remember(kind, deviceId);
    if (kind === "videoinput") setCamId(deviceId);
    else if (kind === "audioinput") setMicId(deviceId);
    else setSpeakerId(deviceId);
  };

  const join = () => {
    if (camId) remember("videoinput", camId);
    if (micId) remember("audioinput", micId);
    if (speakerId) remember("audiooutput", speakerId);
    onJoin({ cameraId: camId, micId, speakerId, cameraEnabled, micEnabled });
  };

  const joinLabel = joining
    ? isHost ? "Starting…" : "Joining…"
    : listenOnly ? "Join to listen"
    : isHost ? "Start meeting" : "Join meeting";

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-5 px-4">
      <div className="w-full max-w-sm flex flex-col gap-3">
        {/* Preview */}
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-[var(--line)] shadow-sm">
          {stream && cameraEnabled && stream.getVideoTracks().length > 0 ? (
            <PreviewVideo stream={stream} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-1.5">
              <span className="text-[var(--fg-muted)]"><CamGlyph off /></span>
              <span className="text-xs text-[var(--fg-muted)]">
                {cameraDenied ? "Camera blocked" : cameraEnabled ? "No camera" : "Camera off"}
              </span>
            </div>
          )}

          {/* Mic + camera toggles, over the preview the way a call has them */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMicEnabled((v) => !v)}
              disabled={micDenied || mics.length === 0}
              title={micEnabled ? "Join muted" : "Join unmuted"}
              aria-pressed={micEnabled}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
                micEnabled ? "bg-white/15 text-white hover:bg-white/25" : "bg-[var(--status-danger)] text-white"
              }`}
            >
              <MicGlyph off={!micEnabled} />
            </button>
            <button
              type="button"
              onClick={() => setCameraEnabled((v) => !v)}
              disabled={cameraDenied || cameras.length === 0}
              title={cameraEnabled ? "Join with camera off" : "Join with camera on"}
              aria-pressed={cameraEnabled}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
                cameraEnabled ? "bg-white/15 text-white hover:bg-white/25" : "bg-[var(--status-danger)] text-white"
              }`}
            >
              <CamGlyph off={!cameraEnabled} />
            </button>
          </div>

          {/* Live level, so "is my mic working" is answered before the call */}
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-sm px-2.5 py-1.5">
            <span className="text-white/80"><MicGlyph off={!micEnabled} /></span>
            <MicMeter level={level} active={micEnabled && !micDenied} />
          </div>
        </div>

        {/* Join card */}
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] overflow-hidden">
          <div className="px-5 pt-5 pb-4 flex flex-col gap-4">
            <p className="text-base font-semibold text-[var(--fg-primary)]">
              {isHost ? "Ready to start?" : "Ready to join?"}
            </p>

            <input
              type="text"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder="Your name"
              className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
            />

            {problems.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {problems.map((p) => (
                  <li
                    key={p.kind}
                    className="flex items-start gap-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-2 text-xs text-[var(--fg-secondary)]"
                  >
                    <span aria-hidden="true">⚠</span>
                    <span>{p.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-xs text-[var(--fg-muted)]">Devices</p>

              {cameras.length > 0 && (
                <label className="flex items-center gap-2">
                  <span className="text-[var(--fg-muted)] shrink-0"><CamGlyph /></span>
                  <span className="sr-only">Camera</span>
                  <select
                    value={camId}
                    onChange={(e) => choose("videoinput", e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] truncate"
                  >
                    {cameras.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                  </select>
                </label>
              )}

              {mics.length > 0 && (
                <label className="flex items-center gap-2">
                  <span className="text-[var(--fg-muted)] shrink-0"><MicGlyph /></span>
                  <span className="sr-only">Microphone</span>
                  <select
                    value={micId}
                    onChange={(e) => choose("audioinput", e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] truncate"
                  >
                    {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                  </select>
                </label>
              )}

              {speakers.length > 0 && (
                <label className="flex items-center gap-2">
                  <span className="text-[var(--fg-muted)] shrink-0"><SpeakerGlyph /></span>
                  <span className="sr-only">Speaker</span>
                  <select
                    value={speakerId}
                    onChange={(e) => choose("audiooutput", e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] truncate"
                  >
                    {speakers.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>

          {/* The meeting's own link, ready to hand to whoever is missing */}
          <div className="px-5 py-3 border-t border-[var(--line)] bg-[var(--surface-0)]">
            <MeetingShareLink roomCode={roomCode} title={meetingTitle} scheduledAt={scheduledAt} />
          </div>

          <div className="px-5 pb-5 pt-3">
            <button
              type="button"
              onClick={join}
              disabled={joining}
              className="w-full rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-50 text-white text-sm font-semibold py-2.5 transition-colors"
            >
              {joinLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
