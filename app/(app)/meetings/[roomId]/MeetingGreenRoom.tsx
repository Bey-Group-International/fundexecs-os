"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rememberDevice, rememberedDevice } from "@/lib/meetings/device-prefs";
import {
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
import {
  BACKGROUND_PREF_KEY,
  NO_BACKGROUND,
  decodeEffect,
  encodeEffect,
  needsSegmentation,
  type BackgroundEffect,
} from "@/lib/meetings/backgrounds";
import { BackgroundProcessor } from "@/lib/meetings/background-processor";
import { getBackground } from "@/lib/meetings/background-store";
import { BackgroundPicker } from "./BackgroundPicker";
import { admissionStatusCopy, canPressJoin, type AdmissionUiState } from "@/lib/meetings/admission-ui";

/** What the member settled on before pressing Join. */
export interface GreenRoomChoice {
  cameraId: string;
  micId: string;
  speakerId: string;
  cameraEnabled: boolean;
  micEnabled: boolean;
  /** The background settled on here, so the call opens already wearing it. */
  background: BackgroundEffect;
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
  /**
   * Where this joiner is in being let in. The waiting room is this screen —
   * everything above the button stays live while they wait, because a wait is
   * the only idle time in a meeting and it is when people fix their camera.
   */
  admission?: AdmissionUiState;
  /** Abandon the wait. Required whenever `admission` can leave "idle". */
  onCancelAdmission?: () => void;
  /** Hands the live preview stream up so the room can release it before it
   *  opens the real sending stream — some platforms will not grant the same
   *  camera twice. */
  onPreviewStream?: (stream: MediaStream | null) => void;
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

/**
 * The pre-join preview, with the chosen background applied.
 *
 * This is where people check how they look, so a background chosen here has to
 * be visible here — showing the raw room and applying the effect only after
 * joining would mean the first person to see it is somebody else.
 *
 * The processor is torn down and rebuilt when the effect changes rather than
 * kept warm: the green room is a screen someone spends seconds on, and holding
 * a segmentation loop open while they read the join button is not worth it.
 */
function BackgroundPreview({
  track, effect, image, onUnavailable,
}: {
  track: MediaStreamTrack;
  effect: BackgroundEffect;
  image: Blob | null;
  onUnavailable: () => void;
}) {
  const [processed, setProcessed] = useState<MediaStream | null>(null);
  // The raw camera, wrapped for the video element. Memoised on the track so a
  // microphone change — which no longer touches the camera at all — cannot
  // hand this component a new object and restart segmentation.
  const raw = useMemo(() => new MediaStream([track]), [track]);

  useEffect(() => {
    if (!needsSegmentation(effect)) { setProcessed(null); return; }

    let processor: BackgroundProcessor | null = null;
    let cancelled = false;

    void (async () => {
      const built = await BackgroundProcessor.create(track, {
        onSlowFrames: () => { /* the call itself decides to give up, not the lobby */ },
        onUnavailable,
      });
      if (!built) { onUnavailable(); return; }
      if (cancelled) { built.destroy(); return; }
      processor = built;
      built.setEffect(effect, image);
      setProcessed(new MediaStream([built.track]));
    })();

    return () => {
      cancelled = true;
      processor?.destroy();
      setProcessed(null);
    };
  }, [track, effect, image, onUnavailable]);

  // Mirrored either way, which is what the in-call local tile does with the
  // same processed track — a self-view that flips when you pick a background
  // would read as the effect having moved you.
  return <PreviewVideo stream={processed ?? raw} />;
}

function BackgroundGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 20a5.5 5.5 0 0 1 11 0" />
    </svg>
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
  admission = "idle",
  onCancelAdmission,
  onPreviewStream,
}: MeetingGreenRoomProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  // Seeded from the remembered preference rather than left blank. Reading it
  // after the first open is what made joining open the default camera and then
  // immediately close it and reopen the remembered one — two permission-era
  // camera activations, and a light that blinked before anyone had done
  // anything.
  const [camId, setCamId] = useState(() => rememberedDevice("videoinput") ?? "");
  const [micId, setMicId] = useState(() => rememberedDevice("audioinput") ?? "");
  const [speakerId, setSpeakerId] = useState(() => rememberedDevice("audiooutput") ?? "");
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  // Camera and microphone are held as separate tracks, not as one stream.
  // They used to share a single getUserMedia call that re-ran on every change,
  // so picking a different microphone closed and reopened the camera: the
  // preview went black, the camera light blinked, and — because the background
  // preview is keyed on the video track — a segmentation model was torn down
  // and reloaded because somebody chose a different mic.
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [level, setLevel] = useState(0);
  const [micSettled, setMicSettled] = useState(false);

  // Background, chosen here and carried into the call. Restored from the last
  // call so someone who always blurs does not have to say so every time.
  const [bgEffect, setBgEffect] = useState<BackgroundEffect>(NO_BACKGROUND);
  const [bgImage, setBgImage] = useState<Blob | null>(null);
  const [bgOpen, setBgOpen] = useState(false);
  const [bgUnavailable, setBgUnavailable] = useState(false);

  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  // The device id each live track was actually opened with, so the maintenance
  // effects below can tell a real change of device from React re-running them.
  const openedCamRef = useRef<string | null>(null);
  const openedMicRef = useRef<string | null>(null);
  // Set once the first combined open has settled. Until then the per-device
  // effects stand down, so the two of them cannot race the one that holds the
  // permission prompt.
  const primedRef = useRef(false);
  const micPeakRef = useRef(0);
  // Set the moment someone picks a background here, so the restoration below
  // knows it has been overtaken. Reading a custom image out of IndexedDB is an
  // await, and it is entirely possible to choose something else during it —
  // without this the remembered background lands on top of the newer choice and
  // then travels into the call, which is the one place it must not.
  const bgChosenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let remembered: BackgroundEffect;
      try { remembered = decodeEffect(window.localStorage.getItem(BACKGROUND_PREF_KEY)); }
      catch { return; }
      if (!needsSegmentation(remembered)) return;
      if (remembered.kind === "custom") {
        // The id is remembered per browser but the image may have been deleted;
        // fall back rather than previewing a background that no longer exists.
        const stored = await getBackground(remembered.id);
        if (cancelled || bgChosenRef.current) return;
        if (!stored) return;
        setBgImage(stored.blob);
      }
      if (!cancelled && !bgChosenRef.current) setBgEffect(remembered);
    })();
    return () => { cancelled = true; };
  }, []);

  const chooseBackground = useCallback((effect: BackgroundEffect, image?: Blob | null) => {
    bgChosenRef.current = true;
    setBgEffect(effect);
    setBgImage(image ?? null);
    try { window.localStorage.setItem(BACKGROUND_PREF_KEY, encodeEffect(effect)); } catch { /* storage disabled */ }
  }, []);

  const onBackgroundUnavailable = useCallback(() => {
    setBgUnavailable(true);
    setBgEffect(NO_BACKGROUND);
  }, []);

  const onPreviewStreamRef = useRef(onPreviewStream);
  useEffect(() => { onPreviewStreamRef.current = onPreviewStream; }, [onPreviewStream]);

  // Mirrors of the choices, for the mount-only open and the failure handler:
  // both need the current value without being re-created when it changes.
  const camIdRef = useRef(camId);
  const micIdRef = useRef(micId);
  const cameraEnabledRef = useRef(cameraEnabled);
  useEffect(() => { camIdRef.current = camId; }, [camId]);
  useEffect(() => { micIdRef.current = micId; }, [micId]);
  useEffect(() => { cameraEnabledRef.current = cameraEnabled; }, [cameraEnabled]);

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
  // Camera and microphone are opened together once, then maintained
  // independently. The single combined re-acquisition this replaces meant
  // every device change closed BOTH devices and reopened them: choosing a
  // different microphone blacked out the preview, blinked the camera light,
  // and rebuilt the background segmenter from scratch.

  /** Adopt a video track, releasing whatever it replaces. */
  const adoptVideo = useCallback((track: MediaStreamTrack | null) => {
    const previous = videoTrackRef.current;
    if (previous && previous !== track) { try { previous.stop(); } catch { /* already stopped */ } }
    videoTrackRef.current = track;
    setVideoTrack(track);
  }, []);

  const adoptAudio = useCallback((track: MediaStreamTrack | null) => {
    const previous = audioTrackRef.current;
    if (previous && previous !== track) { try { previous.stop(); } catch { /* already stopped */ } }
    audioTrackRef.current = track;
    setAudioTrack(track);
  }, []);

  /** What a failed open means, translated into the flags the UI reads. */
  const handleOpenFailure = useCallback((kind: "videoinput" | "audioinput", err: unknown) => {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      if (kind === "videoinput") setCameraDenied(true); else setMicDenied(true);
      return;
    }
    if (name === "OverconstrainedError" || name === "NotFoundError") {
      // A remembered device that has since been unplugged. Forget it; the
      // effect re-runs against the system default rather than leaving the
      // member staring at a black square.
      if (kind === "videoinput") { if (camIdRef.current) { setCamId(""); return; } adoptVideo(null); return; }
      if (micIdRef.current) { setMicId(""); return; }
      adoptAudio(null);
      return;
    }
    // NotReadableError and friends: the device exists but something else has
    // it. Nothing to fall back to, so leave the flags alone and show nothing
    // rather than a wrong diagnosis.
    if (kind === "videoinput") adoptVideo(null); else adoptAudio(null);
  }, [adoptVideo, adoptAudio]);

  // First open: one getUserMedia for both, because asking separately puts two
  // permission dialogs in front of somebody trying to join a meeting.
  useEffect(() => {
    let cancelled = false;

    async function openBoth() {
      const wantVideo = cameraEnabledRef.current;
      const cam = camIdRef.current;
      const mic = micIdRef.current;
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: wantVideo ? constraintsFor("videoinput", cam || null) : false,
          audio: constraintsFor("audioinput", mic || null),
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        const v = s.getVideoTracks()[0] ?? null;
        const a = s.getAudioTracks()[0] ?? null;
        adoptVideo(v);
        adoptAudio(a);
        // The id we asked for wins over the one reported back: a browser that
        // resolves "default" to a concrete id would otherwise look like a
        // device change on the next render and reopen the camera in a loop.
        openedCamRef.current = cam || v?.getSettings().deviceId || null;
        openedMicRef.current = mic || a?.getSettings().deviceId || null;
        setCameraDenied(false);
        setMicDenied(false);

        // Labels only arrive once permission is granted, so the pickers stay
        // anonymous until this point. Re-enumerating here is what fills them in.
        await refreshDevices();
        if (cancelled) return;
        if (!cam && openedCamRef.current) setCamId(openedCamRef.current);
        if (!mic && openedMicRef.current) setMicId(openedMicRef.current);
        return;
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          // The browser does not say which of the two was refused, and asking
          // separately would mean two prompts. Treat a blanket refusal as both.
          setCameraDenied(wantVideo);
          setMicDenied(true);
          await refreshDevices();
          return;
        }
        // A combined request fails whole. A laptop with no webcam, or a camera
        // another application already holds, used to cost the microphone too —
        // the member arrived in the green room with no preview AND no meter,
        // and no way to tell which device was the problem. Retry them apart.
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: constraintsFor("audioinput", mic || null),
          });
          if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
          adoptAudio(audioOnly.getAudioTracks()[0] ?? null);
          openedMicRef.current = mic || audioOnly.getAudioTracks()[0]?.getSettings().deviceId || null;
          setMicDenied(false);
        } catch (audioErr) {
          if (!cancelled) handleOpenFailure("audioinput", audioErr);
        }
        if (cancelled || !wantVideo) { await refreshDevices(); return; }
        try {
          const videoOnly = await navigator.mediaDevices.getUserMedia({
            video: constraintsFor("videoinput", cam || null),
          });
          if (cancelled) { videoOnly.getTracks().forEach((t) => t.stop()); return; }
          adoptVideo(videoOnly.getVideoTracks()[0] ?? null);
          openedCamRef.current = cam || videoOnly.getVideoTracks()[0]?.getSettings().deviceId || null;
          setCameraDenied(false);
        } catch (videoErr) {
          if (!cancelled) handleOpenFailure("videoinput", videoErr);
        }
        await refreshDevices();
      }
    }

    void openBoth().finally(() => { primedRef.current = true; });
    return () => { cancelled = true; };
    // Mount only: the effects below maintain each device from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The camera, and only the camera.
  useEffect(() => {
    if (!primedRef.current) return;
    if (!cameraEnabled) {
      // Off means closed, not disabled: the hardware light staying dark is the
      // whole point of the toggle.
      adoptVideo(null);
      openedCamRef.current = null;
      return;
    }
    if (cameraDenied) return;
    if (videoTrackRef.current && openedCamRef.current === (camId || null)) return;

    let cancelled = false;
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: constraintsFor("videoinput", camId || null),
          audio: false,
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        adoptVideo(s.getVideoTracks()[0] ?? null);
        openedCamRef.current = camId || s.getVideoTracks()[0]?.getSettings().deviceId || null;
        setCameraDenied(false);
        await refreshDevices();
      } catch (err) {
        if (!cancelled) handleOpenFailure("videoinput", err);
      }
    })();
    return () => { cancelled = true; };
  }, [camId, cameraEnabled, cameraDenied, adoptVideo, refreshDevices, handleOpenFailure]);

  // The microphone, and only the microphone.
  useEffect(() => {
    if (!primedRef.current) return;
    if (micDenied) { adoptAudio(null); openedMicRef.current = null; return; }
    if (audioTrackRef.current && openedMicRef.current === (micId || null)) return;

    let cancelled = false;
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: constraintsFor("audioinput", micId || null),
          video: false,
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        adoptAudio(s.getAudioTracks()[0] ?? null);
        openedMicRef.current = micId || s.getAudioTracks()[0]?.getSettings().deviceId || null;
        setMicDenied(false);
        await refreshDevices();
      } catch (err) {
        if (!cancelled) handleOpenFailure("audioinput", err);
      }
    })();
    return () => { cancelled = true; };
  }, [micId, micDenied, adoptAudio, refreshDevices, handleOpenFailure]);

  // The stream the room takes over. Rebuilt only when a track actually changes,
  // so the room is not handed a new object every render.
  const previewStream = useMemo(() => {
    const tracks = [videoTrack, audioTrack].filter((t): t is MediaStreamTrack => t !== null);
    return tracks.length > 0 ? new MediaStream(tracks) : null;
  }, [videoTrack, audioTrack]);

  useEffect(() => { onPreviewStreamRef.current?.(previewStream); }, [previewStream]);

  // Release on unmount. The room stops the same tracks before it opens its own
  // stream, so this is a backstop for leaving the page without joining.
  useEffect(() => {
    return () => {
      try { videoTrackRef.current?.stop(); } catch { /* already stopped */ }
      try { audioTrackRef.current?.stop(); } catch { /* already stopped */ }
      videoTrackRef.current = null;
      audioTrackRef.current = null;
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
    const track = audioTrack;
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
  }, [audioTrack, micEnabled]);

  // A fresh microphone deserves a fresh verdict.
  useEffect(() => {
    micPeakRef.current = 0;
    setMicSettled(false);
  }, [micId]);

  // ── Remembered choices ───────────────────────────────────────────────────
  useEffect(() => {
    if (devices.length === 0) return;
    setCamId((current) => current || pickDevice(devices, "videoinput", rememberedDevice("videoinput"))?.deviceId || "");
    setMicId((current) => current || pickDevice(devices, "audioinput", rememberedDevice("audioinput"))?.deviceId || "");
    setSpeakerId((current) => current || pickDevice(devices, "audiooutput", rememberedDevice("audiooutput"))?.deviceId || "");
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
    rememberDevice(kind, deviceId);
    if (kind === "videoinput") setCamId(deviceId);
    else if (kind === "audioinput") setMicId(deviceId);
    else setSpeakerId(deviceId);
  };

  const join = () => {
    if (!canPressJoin(admission)) return;
    rememberDevice("videoinput", camId);
    rememberDevice("audioinput", micId);
    rememberDevice("audiooutput", speakerId);
    onJoin({ cameraId: camId, micId, speakerId, cameraEnabled, micEnabled, background: bgEffect });
  };

  const waitCopy = admissionStatusCopy(admission);
  const joinLabel = joining
    ? isHost ? "Starting…" : "Joining…"
    : listenOnly ? "Join to listen"
    : isHost ? "Start meeting" : "Join meeting";

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-5 px-4">
      <div className="w-full max-w-sm flex flex-col gap-3">
        {/* Preview */}
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-[var(--line)] shadow-sm">
          {videoTrack && cameraEnabled ? (
            <BackgroundPreview
              track={videoTrack}
              effect={bgEffect}
              image={bgImage}
              onUnavailable={onBackgroundUnavailable}
            />
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
            {/* Backgrounds, beside the camera toggle they belong to. Disabled
                with the camera: there is nothing to put a background behind. */}
            <button
              type="button"
              onClick={() => setBgOpen((v) => !v)}
              disabled={!cameraEnabled || cameraDenied || bgUnavailable}
              title="Background effects"
              aria-label="Background effects"
              aria-expanded={bgOpen}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
                bgEffect.kind !== "none" ? "bg-[var(--gold-400)] text-white" : "bg-white/15 text-white hover:bg-white/25"
              }`}
            >
              <BackgroundGlyph />
            </button>
          </div>

          {/* Live level, so "is my mic working" is answered before the call */}
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-sm px-2.5 py-1.5">
            <span className="text-white/80"><MicGlyph off={!micEnabled} /></span>
            <MicMeter level={level} active={micEnabled && !micDenied} />
          </div>
        </div>

        {bgOpen && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--fg-secondary)]">Background</p>
              <button
                type="button"
                onClick={() => setBgOpen(false)}
                className="text-xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
              >
                Done
              </button>
            </div>
            <BackgroundPicker
              effect={bgEffect}
              unavailable={bgUnavailable}
              onChange={chooseBackground}
            />
          </div>
        )}

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

          {/* The button's slot becomes the wait. Nothing above it moves, so the
              preview does not re-render and every control stays usable. */}
          <div className="px-5 pb-5 pt-3">
            {waitCopy ? (
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-center"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`w-2 h-2 rounded-full ${admission === "timed-out" ? "bg-[var(--status-warning)]" : "bg-[var(--gold-400)] animate-pulse"}`}
                  />
                  <span className="text-sm font-semibold text-[var(--fg-primary)]">{waitCopy.title}</span>
                </div>
                <p className="text-xs text-[var(--fg-muted)]">{waitCopy.detail}</p>
                {waitCopy.cancelLabel && onCancelAdmission && (
                  <button
                    type="button"
                    onClick={onCancelAdmission}
                    className="text-xs text-[var(--fg-muted)] underline underline-offset-2 hover:text-[var(--status-danger)] transition-colors"
                  >
                    {waitCopy.cancelLabel}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={join}
                disabled={joining}
                className="w-full rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-50 text-white text-sm font-semibold py-2.5 transition-colors"
              >
                {joinLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
