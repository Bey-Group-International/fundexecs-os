"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rememberDevice, rememberedDevice } from "@/lib/meetings/device-prefs";
import {
  canJoin as canJoinWith,
  constraintsFor,
  devicesOfKind,
  MIC_SILENT_PEAK,
  levelBars,
  levelFromSamples,
  pickDevice,
  readinessProblems,
  smoothLevel,
  type Device,
  type DeviceKind,
  type ReadinessProblem,
  settleCamera,
} from "@/lib/meetings/devices";
import { echoRisk, echoRiskNotice } from "@/lib/meetings/echo";
import {
  CAMERA_SETTLE_MS,
  blockedReason,
  checkCopy,
  checkStage,
  deviceChanged,
  deviceCheckRequired,
  deviceOffBlocksEntry,
  entryAllowed,
  measuringChosenDevice,
  offSteps,
  shouldLatch,
  type CheckStage,
  type CheckedDevice,
} from "@/lib/meetings/device-check";
import {
  RETRY_SAME_DEVICE_MS,
  canRetrySameDevice,
  classifyMediaError,
} from "@/lib/meetings/media-acquisition";
import { MeetingShareLink } from "../MeetingShareLink";
import {
  BACKGROUND_PREF_KEY,
  NO_BACKGROUND,
  decodeEffect,
  encodeEffect,
  needsSegmentation,
  type BackgroundEffect,
} from "@/lib/meetings/backgrounds";
import type { BackgroundProcessor } from "@/lib/meetings/background-processor";
import { getBackground } from "@/lib/meetings/background-store";
import { admissionStatusCopy, canPressJoin, type AdmissionUiState } from "@/lib/meetings/admission-ui";
import {
  browserFamily,
  deviceSummary,
  leadProblem,
  problemGuide,
  waitedLabel,
  type BrowserFamily,
} from "@/lib/meetings/green-room";
import { useResumeOnReturn } from "./room-shared";
import nextDynamic from "next/dynamic";

// Loaded when someone picks a background, not with the room: the picker and
// the processor behind it are code most calls never run, and the segmenter
// they drive was already fetched on demand.
const BackgroundPicker = nextDynamic(
  () => import("./BackgroundPicker").then((m) => m.BackgroundPicker),
  { ssr: false, loading: () => <p className="px-1 py-2 text-xs text-[var(--fg-muted)]">Loading backgrounds…</p> },
);

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
  /**
   * An invite-link guest, who has to prove their camera and microphone work
   * before this screen will let them through. See lib/meetings/device-check.ts
   * for why it is only them.
   */
  isGuest?: boolean;
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
  /**
   * Hands the live preview stream up, with the means to keep it.
   *
   * The room used to stop these tracks and immediately open the same devices
   * again. That reopen is the single most expensive thing on the join path —
   * a few hundred milliseconds on a laptop and considerably more on Windows,
   * a camera light that blinks off and on, and a genuine race, because a
   * camera released a moment ago is often still held when it is asked for
   * again. All of it to arrive at the tracks that were already open.
   *
   * So the room may ADOPT these instead. `release` is how it says it has: once
   * called, this screen stops treating the tracks as its own and will not stop
   * them on unmount or when replacing them. Calling it without taking the
   * tracks would leak a camera, so it is the room's undertaking that it now
   * owns them.
   */
  onPreviewStream?: (stream: MediaStream | null, release: () => void) => void;
  /**
   * "check" is a rehearsal with no meeting behind it: the same preview, meter,
   * devices and backgrounds, with no name to give, no link to share and Done
   * where Join would be. Reached from the lobby's "Test your camera & mic".
   */
  mode?: "join" | "check";
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

/**
 * getUserMedia, with one more go at a device that is merely busy.
 *
 * The green room is usually the FIRST thing to ask for the camera, and the
 * commonest reason it is already taken is the page that was just here — a
 * reload, a bounce through the invite link, a back-and-forward. Releasing a
 * camera is asynchronous on Windows, so the reopen lands a few milliseconds
 * early and loses a race it would have won on a second attempt. The call itself
 * has retried this for a while (see media-acquisition.ts); the screen that
 * decides whether someone HAS a camera did not, which is the wrong way round.
 */
async function openWithRetry(constraints: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (!canRetrySameDevice(classifyMediaError(err))) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_SAME_DEVICE_MS));
    return navigator.mediaDevices.getUserMedia(constraints);
  }
}

/** Segmented mic meter — the thing that answers "can they actually hear me?". */
/** Bars in the mic meter; the level is only re-rendered when this many change. */
const MIC_METER_BARS = 12;

function MicMeter({ level, active, bars = MIC_METER_BARS }: { level: number; active: boolean; bars?: number }) {
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


/**
 * One device's row in the required check.
 *
 * Three things, always in the same place: what it is, where it has got to, and
 * what to do about it. The question stays visible while the steps are showing,
 * because the steps are what to change and the question is how the person says
 * the change worked — a row that only accused and never let them answer again
 * would be a dead end with instructions on it.
 */
function CheckRow({
  device, stage, message, steps, onAnswer,
}: {
  device: CheckedDevice;
  stage: CheckStage;
  /** The named fault for this device, when there is one, in its own words. */
  message: string | null;
  steps: readonly string[];
  onAnswer: (yes: boolean) => void;
}) {
  const copy = checkCopy(device, stage);
  const passed = stage === "passed";
  const wrong = stage === "blocked" || stage === "rejected";

  return (
    <li className="flex flex-col gap-1.5 rounded-lg bg-[var(--surface-2)] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={
            passed ? "text-[var(--status-success,#16a34a)]"
            : wrong ? "text-[var(--status-danger)]"
            : "text-[var(--fg-muted)]"
          }
        >
          {passed ? "✓" : wrong ? "⚠" : "•"}
        </span>
        <span className="text-xs font-medium text-[var(--fg-primary)]">{copy.label}</span>
        <span className="ml-auto text-[11px] text-[var(--fg-muted)]">
          {passed ? "Checked"
            : stage === "measuring" ? "Checking…"
            : stage === "confirming" ? "Your turn"
            : "Needs attention"}
        </span>
      </div>

      {copy.question && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <span className="text-xs text-[var(--fg-secondary)]">{copy.question}</span>
          <span className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onAnswer(true)}
              className="min-h-11 rounded-md bg-[var(--gold-400)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--gold-500)] sm:min-h-8"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className="min-h-11 rounded-md border border-[var(--line)] px-3 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-3)] sm:min-h-8"
            >
              No
            </button>
          </span>
        </div>
      )}

      {/* The device's own words when something named itself, ours otherwise. */}
      {(message || steps.length > 0) && (
        <div className="pl-6">
          {message && <p className="text-[11px] leading-snug text-[var(--fg-secondary)]">{message}</p>}
          {steps.length > 0 && (
            <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-4 text-[11px] leading-snug text-[var(--fg-secondary)]">
              {steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}
        </div>
      )}
    </li>
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
  // A guest waiting to be let in on a phone switches apps and comes back to a
  // preview that is paused on its last frame. See useResumeOnReturn.
  useResumeOnReturn(ref);
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

  // Deliberately still `BackgroundProcessor`, not the room's `MaskDriver`.
  //
  // The driver's whole value is moving a long call's per-frame cost off the main
  // thread, and this preview is neither long nor competing with anything: there
  // are no peers, no decoding, no React tree being re-rendered by a dozen
  // channels. What it would add is a second worker and a second 12MB WASM heap,
  // standing up at the exact moment the room is standing up its own -- the two
  // overlap by a few hundred milliseconds on every join, which is the handover
  // `watchSource` exists for. Paying that to speed up a preview that is about to
  // be thrown away would be a regression precisely where joining is slowest.
  //
  // The preview still warms what matters: the segmenter is cached per page, so
  // the room's pipeline finds it already loaded either way.
  useEffect(() => {
    if (!needsSegmentation(effect)) { setProcessed(null); return; }

    let processor: BackgroundProcessor | null = null;
    let cancelled = false;

    void (async () => {
      const { BackgroundProcessor } = await import("@/lib/meetings/background-processor");
      if (cancelled) return;
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
  isGuest = false,
  joining,
  displayName,
  onDisplayNameChange,
  meetingTitle,
  scheduledAt,
  onJoin,
  admission = "idle",
  onCancelAdmission,
  onPreviewStream,
  mode = "join",
}: MeetingGreenRoomProps) {
  const checking = mode === "check";
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
  // "Something else has it" is a different fault from "there isn't one", and
  // the instruction that follows from it is different too. Reported separately
  // because a member told to go and find a camera they are looking at will
  // simply join without one.
  const [cameraBusy, setCameraBusy] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
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

  // ── The required check, for a guest ──────────────────────────────────────
  //
  // Two halves per device, and both are needed: the browser has to report
  // signal, and the person has to say the signal is of them. See
  // lib/meetings/device-check.ts for why neither alone is enough.
  //
  // `*Checked` are LATCHES. Once a device has been proved, nothing un-proves
  // it — not falling silent, not switching the camera off before joining —
  // because the alternative is a screen that takes the pass away again and
  // cannot be completed. Choosing a DIFFERENT device does clear it, below:
  // what was proved was one piece of hardware.
  const [cameraSeen, setCameraSeen] = useState(false);
  const [cameraSettled, setCameraSettled] = useState(false);
  const [cameraSaidYes, setCameraSaidYes] = useState<boolean | null>(null);
  const [micSaidYes, setMicSaidYes] = useState<boolean | null>(null);
  const [cameraChecked, setCameraChecked] = useState(false);
  const [micChecked, setMicChecked] = useState(false);

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
  //
  // State rather than a ref, and the difference is a bug: the first open can
  // CHANGE these effects' inputs while they are still standing down. A
  // remembered camera that has since been unplugged fails overconstrained, and
  // the recovery is to forget the id and re-open against the system default —
  // but the setCamId("") that forgets it happens during the first open, so the
  // camera effect ran once, saw an unprimed room, and returned. A ref does not
  // re-render, so nothing ever ran it again: the member sat looking at "No
  // camera found" with a working camera plugged in, and at "No microphone
  // found" with a working microphone. Flipping state re-runs them both.
  const [primed, setPrimed] = useState(false);
  // Bumped by "Try again". Both device effects depend on it, so a press re-runs
  // whichever of them has no track — after the person has changed the site's
  // permission or closed the app holding the device — without a reload, which
  // would throw away the name they typed and their place in the waiting room.
  const [retryKey, setRetryKey] = useState(0);
  // The device pickers, folded into one line unless something needs them.
  // Null until the person opens or closes them: until then a problem opens them.
  const [devicesOpenChoice, setDevicesOpenChoice] = useState<boolean | null>(null);
  // Which browser's permission steps to give. Read after mount: the server
  // has no user agent to render with, and guessing would hydrate-mismatch.
  const [browser, setBrowser] = useState<BrowserFamily>("other");
  useEffect(() => { setBrowser(browserFamily(navigator.userAgent)); }, []);
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

  // The exact tracks the room has taken over. Every place that would stop a
  // track checks this first: a track in here belongs to the call, and stopping
  // it would darken a camera that is already on the wire.
  //
  // It records tracks rather than a flag because the handover is not the end of
  // this screen's life. A guest who is admitted still sits here until the room
  // renders, and a device change in that window opens a NEW track that the call
  // never took. A flag would have exempted that one too, and the green room
  // would walk away leaving a camera light on with nothing reading it.
  const relinquishedRef = useRef<Set<MediaStreamTrack>>(new Set());
  const release = useCallback(() => {
    if (videoTrackRef.current) relinquishedRef.current.add(videoTrackRef.current);
    if (audioTrackRef.current) relinquishedRef.current.add(audioTrackRef.current);
  }, []);

  // Mirrors of the choices, for the mount-only open and the failure handler:
  // both need the current value without being re-created when it changes.
  const camIdRef = useRef(camId);
  const micIdRef = useRef(micId);
  const cameraEnabledRef = useRef(cameraEnabled);
  // Read by the device-loss listeners below, which must not be re-attached to
  // a live track every time the Join button changes state.
  const joiningRef = useRef(joining);
  useEffect(() => { joiningRef.current = joining; }, [joining]);
  useEffect(() => { camIdRef.current = camId; }, [camId]);
  useEffect(() => { micIdRef.current = micId; }, [micId]);
  useEffect(() => { cameraEnabledRef.current = cameraEnabled; }, [cameraEnabled]);

  const cameras = useMemo(() => devicesOfKind(devices, "videoinput"), [devices]);
  const mics = useMemo(() => devicesOfKind(devices, "audioinput"), [devices]);
  const speakers = useMemo(() => devicesOfKind(devices, "audiooutput"), [devices]);

  /**
   * Whether the chosen output leaves the browser's echo canceller blind.
   *
   * The canceller subtracts what is being played from what is being captured,
   * and it holds that reference for the DEFAULT render device. Choosing another
   * output moves the audio off it; the capture does not follow. So sound comes
   * out of a speaker the canceller cannot hear, nothing is subtracted, and
   * everybody else hears themselves back — while the member who chose it is the
   * one person who cannot hear the problem.
   *
   * `echoRisk` reads `groupId`, so "this is a headset" is a fact from the
   * device list rather than a guess at a product name, and a headset is
   * correctly silent here.
   */
  const echoWarning = useMemo(
    () => echoRiskNotice(echoRisk({ micId, speakerId, devices })),
    [micId, speakerId, devices],
  );

  /** Re-read the device list. Returns it too, for a decision that cannot wait a render. */
  const refreshDevices = useCallback(async (): Promise<Device[]> => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const list = toDevices(all);
      setDevices(list);
      return list;
    } catch {
      setDevices([]);
      return [];
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
    if (previous && previous !== track && !relinquishedRef.current.has(previous)) {
      try { previous.stop(); } catch { /* already stopped */ }
    }
    videoTrackRef.current = track;
    setVideoTrack(track);
  }, []);

  const adoptAudio = useCallback((track: MediaStreamTrack | null) => {
    const previous = audioTrackRef.current;
    if (previous && previous !== track && !relinquishedRef.current.has(previous)) {
      try { previous.stop(); } catch { /* already stopped */ }
    }
    audioTrackRef.current = track;
    setAudioTrack(track);
  }, []);

  /** What a failed open means, translated into the flags the UI reads. */
  const handleOpenFailure = useCallback((kind: "videoinput" | "audioinput", err: unknown) => {
    // The same classifier the call itself uses, rather than a second reading of
    // DOMException names that drifted from it — the legacy spellings are still
    // in the wild and only one of these two lists had them.
    const failure = classifyMediaError(err);
    if (failure === "denied") {
      if (kind === "videoinput") { setCameraDenied(true); setCameraBusy(false); }
      else { setMicDenied(true); setMicBusy(false); }
      return;
    }
    if (failure === "overconstrained" || failure === "missing") {
      // A remembered device that has since been unplugged. Forget it; the
      // effect re-runs against the system default rather than leaving the
      // member staring at a black square.
      if (kind === "videoinput") {
        setCameraBusy(false);
        if (camIdRef.current) { setCamId(""); return; }
        adoptVideo(null);
        return;
      }
      setMicBusy(false);
      if (micIdRef.current) { setMicId(""); return; }
      adoptAudio(null);
      return;
    }
    // NotReadableError and friends: the device exists and something else has
    // it. There is nothing to fall back to — the permission is fine and so is
    // the hardware — so say which of the two it is, because "no camera found"
    // sends somebody looking for a camera that is plugged in and working.
    if (kind === "videoinput") { setCameraBusy(failure === "in_use"); adoptVideo(null); }
    else { setMicBusy(failure === "in_use"); adoptAudio(null); }
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
        const s = await openWithRetry({
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
        setCameraBusy(false);
        setMicBusy(false);

        // Labels only arrive once permission is granted, so the pickers stay
        // anonymous until this point. Re-enumerating here is what fills them in.
        const list = await refreshDevices();
        if (cancelled) return;
        // What the browser opened becomes the choice -- unless, now that the
        // labels are in, it turns out to be a phone standing in for a camera
        // and a real one is plugged in. Then the real one is the choice, and
        // the camera effect below swaps to it. See settleCamera.
        if (!cam && openedCamRef.current) setCamId(settleCamera(list, openedCamRef.current));
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
          const audioOnly = await openWithRetry({
            audio: constraintsFor("audioinput", mic || null),
          });
          if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
          adoptAudio(audioOnly.getAudioTracks()[0] ?? null);
          openedMicRef.current = mic || audioOnly.getAudioTracks()[0]?.getSettings().deviceId || null;
          setMicDenied(false);
          setMicBusy(false);
        } catch (audioErr) {
          if (!cancelled) handleOpenFailure("audioinput", audioErr);
        }
        if (cancelled || !wantVideo) { await refreshDevices(); return; }
        try {
          const videoOnly = await openWithRetry({
            video: constraintsFor("videoinput", cam || null),
          });
          if (cancelled) { videoOnly.getTracks().forEach((t) => t.stop()); return; }
          adoptVideo(videoOnly.getVideoTracks()[0] ?? null);
          openedCamRef.current = cam || videoOnly.getVideoTracks()[0]?.getSettings().deviceId || null;
          setCameraDenied(false);
          setCameraBusy(false);
        } catch (videoErr) {
          if (!cancelled) handleOpenFailure("videoinput", videoErr);
        }
        await refreshDevices();
      }
    }

    void openBoth().finally(() => { setPrimed(true); });
    return () => { cancelled = true; };
    // Mount only: the effects below maintain each device from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The camera, and only the camera.
  useEffect(() => {
    if (!primed) return;
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
        const s = await openWithRetry({
          video: constraintsFor("videoinput", camId || null),
          audio: false,
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        adoptVideo(s.getVideoTracks()[0] ?? null);
        const openedId = camId || s.getVideoTracks()[0]?.getSettings().deviceId || null;
        openedCamRef.current = openedId;
        setCameraDenied(false);
        setCameraBusy(false);
        const list = await refreshDevices();
        if (cancelled) return;
        // Unconstrained again -- a remembered camera that was unplugged was
        // forgotten and the browser chose -- so the same settling applies as
        // on the first open: a phone the browser picked gives way to a camera.
        if (!camId && openedId) {
          const settled = settleCamera(list, openedId);
          if (settled !== openedId) setCamId(settled);
        }
      } catch (err) {
        if (!cancelled) handleOpenFailure("videoinput", err);
      }
    })();
    return () => { cancelled = true; };
  }, [primed, camId, cameraEnabled, cameraDenied, adoptVideo, refreshDevices, handleOpenFailure, retryKey]);

  // The microphone, and only the microphone.
  useEffect(() => {
    if (!primed) return;
    if (micDenied) { adoptAudio(null); openedMicRef.current = null; return; }
    if (audioTrackRef.current && openedMicRef.current === (micId || null)) return;

    let cancelled = false;
    void (async () => {
      try {
        const s = await openWithRetry({
          audio: constraintsFor("audioinput", micId || null),
          video: false,
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        adoptAudio(s.getAudioTracks()[0] ?? null);
        openedMicRef.current = micId || s.getAudioTracks()[0]?.getSettings().deviceId || null;
        setMicDenied(false);
        setMicBusy(false);
        await refreshDevices();
      } catch (err) {
        if (!cancelled) handleOpenFailure("audioinput", err);
      }
    })();
    return () => { cancelled = true; };
  }, [primed, micId, micDenied, adoptAudio, refreshDevices, handleOpenFailure, retryKey]);

  // The stream the room takes over. Rebuilt only when a track actually changes,
  // so the room is not handed a new object every render.
  const previewStream = useMemo(() => {
    const tracks = [videoTrack, audioTrack].filter((t): t is MediaStreamTrack => t !== null);
    return tracks.length > 0 ? new MediaStream(tracks) : null;
  }, [videoTrack, audioTrack]);

  useEffect(() => { onPreviewStreamRef.current?.(previewStream, release); }, [previewStream, release]);

  // A device that ends while somebody sits here.
  //
  // A guest in the waiting room is the person most likely to be on a phone and
  // the most likely to be kept waiting, and a phone that is put down stops its
  // capture: on return the track has ENDED, not merely paused. A webcam whose
  // cable is knocked, or a USB headset re-enumerated by a dock, does the same
  // on a desk. Nothing here was listening, so the preview went black and the
  // meter went flat and stayed that way — through the wait, and through the
  // device check, which then told the guest their camera "isn't sending a
  // picture" about a camera that would open fine if asked.
  //
  // The per-device effects above already know how to open whatever is missing,
  // so an ended track is turned into a missing one and they are run again. The
  // same device is asked for first; if it is gone, the ordinary failure path
  // forgets it and falls back to the system default.
  //
  // Not a track the call has taken (it is the call's to recover, and two
  // repairs racing for one camera is the race openCallMedia exists to avoid),
  // and not while a join is in flight, for the same reason.
  useEffect(() => {
    const track = videoTrack;
    if (!track) return;
    const onEnded = () => {
      if (relinquishedRef.current.has(track) || joiningRef.current) return;
      if (videoTrackRef.current !== track) return;
      adoptVideo(null);
      openedCamRef.current = null;
      setRetryKey((k) => k + 1);
    };
    track.addEventListener("ended", onEnded);
    return () => track.removeEventListener("ended", onEnded);
  }, [videoTrack, adoptVideo]);

  useEffect(() => {
    const track = audioTrack;
    if (!track) return;
    const onEnded = () => {
      if (relinquishedRef.current.has(track) || joiningRef.current) return;
      if (audioTrackRef.current !== track) return;
      adoptAudio(null);
      openedMicRef.current = null;
      setRetryKey((k) => k + 1);
    };
    track.addEventListener("ended", onEnded);
    return () => track.removeEventListener("ended", onEnded);
  }, [audioTrack, adoptAudio]);

  // Release on unmount — unless the room took these over, in which case they are
  // live on the wire and stopping them here is exactly the bug this screen used
  // to have in reverse. A backstop for leaving the page without joining.
  useEffect(() => {
    const relinquished = relinquishedRef.current;
    return () => {
      const video = videoTrackRef.current;
      const audio = audioTrackRef.current;
      if (video && !relinquished.has(video)) {
        try { video.stop(); } catch { /* already stopped */ }
      }
      if (audio && !relinquished.has(audio)) {
        try { audio.stop(); } catch { /* already stopped */ }
      }
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
    // A context created before the page has had a user gesture starts
    // suspended, and a suspended analyser reads silence — which is exactly what
    // the readiness check calls a dead microphone. The room does this already;
    // the screen that decides whether to warn somebody did not.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    let raf = 0;
    let smoothed = 0;
    let shownBars = -1;

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);
      smoothed = smoothLevel(smoothed, levelFromSamples(buffer));
      const wasSilent = micPeakRef.current <= MIC_SILENT_PEAK;
      micPeakRef.current = Math.max(micPeakRef.current, smoothed);
      // Only when a bar lights or goes out — or when the mic first proves it
      // works, which the lowest bar cannot show and the "isn't picking anything
      // up" warning is waiting on. The smoothed level never quite settles, so
      // setting it raw re-rendered this whole screen on every display frame,
      // for as long as a guest sat waiting to be let in.
      const bars = levelBars(smoothed, MIC_METER_BARS);
      const heard = wasSilent && micPeakRef.current > MIC_SILENT_PEAK;
      if (bars !== shownBars || heard) { shownBars = bars; setLevel(smoothed); }
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

  // A fresh microphone deserves a fresh verdict — on the TRACK as well as on the
  // choice.
  //
  // Replacing a device is asynchronous. The choice changes now; the new track
  // arrives later; and in between, the old analyser's animation frame is still
  // filling `micPeakRef` from the microphone the guest just rejected. Resetting
  // on `micId` alone left that carried-over peak in place when the new track
  // landed, so an unproved device showed signal that was never its own. Resetting
  // on the track too clears it at the moment the new one takes over; `measured`
  // below is what covers the window itself.
  useEffect(() => {
    micPeakRef.current = 0;
    setMicSettled(false);
  }, [micId, audioTrack]);

  // ── Camera signal ────────────────────────────────────────────────────────
  //
  // Taken from the TRACK rather than from the preview element, deliberately. A
  // camera track is born `muted` and fires `unmute` when frames begin, so this
  // is the camera's own report of whether it is producing — and it stays true
  // when a background effect is on, where reading the rendered preview would
  // instead be reporting on the segmenter. A failed segmenter is not a failed
  // camera, and telling a guest to go and find another camera because a 12MB
  // model did not download is the wrong instruction entirely.
  useEffect(() => {
    const track = videoTrack;
    if (!track || !cameraEnabled) { setCameraSeen(false); return; }

    const look = () => setCameraSeen(track.readyState === "live" && !track.muted);
    look();
    for (const ev of ["unmute", "mute", "ended"]) track.addEventListener(ev, look);
    return () => { for (const ev of ["unmute", "mute", "ended"]) track.removeEventListener(ev, look); };
  }, [videoTrack, cameraEnabled]);

  // The camera's grace period, which `MIC_SETTLE_MS` is for the microphone: a
  // freshly opened camera reports no frame for a moment, and condemning it
  // immediately would accuse one that is merely starting.
  //
  // Started when the TRACK arrives, not when the choice changes. Keyed on
  // `camId` it began while the permission prompt was still on screen, so a guest
  // who took more than three seconds to read the prompt and press Allow was told
  // "your camera opened but isn't sending a picture" about a camera they had not
  // yet allowed. The same premature verdict landed on every "Try again", which
  // starts a fresh open.
  useEffect(() => {
    setCameraSettled(false);
    // A camera switched off on purpose is not "merely slow" — there is nothing
    // coming and nothing to wait for, so the row says so at once rather than
    // sitting on "Checking…" for ever. What it says is deviceOffBlocksEntry's
    // sentence, not the broken-camera one.
    if (!cameraEnabled) { setCameraSettled(true); return; }
    if (!videoTrack) return;
    const settle = setTimeout(() => setCameraSettled(true), CAMERA_SETTLE_MS);
    return () => clearTimeout(settle);
  }, [videoTrack, cameraEnabled]);

  // A different device is a different question. Clearing the answer AND the
  // latch is what stops somebody passing the check on a working webcam and
  // joining on the broken one they picked afterwards.
  const lastCamId = useRef(camId);
  const lastMicId = useRef(micId);
  useEffect(() => {
    if (!deviceChanged(lastCamId.current, camId)) return;
    lastCamId.current = camId;
    setCameraSaidYes(null);
    setCameraChecked(false);
  }, [camId]);
  useEffect(() => {
    if (!deviceChanged(lastMicId.current, micId)) return;
    lastMicId.current = micId;
    setMicSaidYes(null);
    setMicChecked(false);
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
    cameraBusy,
    micBusy,
  });
  const joinable = canJoinWith({ micDenied, mics: mics.length });
  const listenOnly = joinable && micDenied;

  // ── The gate ─────────────────────────────────────────────────────────────
  //
  // A guest only. `problemFor` hands each row the named fault for its own
  // device, so a blocked microphone is reported as blocked rather than as the
  // generic silence it also looks like.
  const checkRequired = deviceCheckRequired({ isGuest });
  const problemFor = (device: CheckedDevice): ReadinessProblem | null =>
    problems.find((p) =>
      device === "camera" ? p.kind.startsWith("camera") || p.kind === "no_camera"
                          : p.kind.startsWith("mic") || p.kind === "no_mic",
    ) ?? null;

  // Only the device the guest actually chose counts. While a replacement is
  // still opening, the one they rejected is live and feeding the meter, and
  // without this they could answer "yes" about it and latch a pass onto
  // hardware that never produced anything. See measuringChosenDevice.
  const measuringCamera = measuringChosenDevice(camId, videoTrack?.getSettings?.().deviceId);
  const measuringMic = measuringChosenDevice(micId, audioTrack?.getSettings?.().deviceId);

  const cameraStage = checkStage({
    passed: cameraChecked,
    problem: problemFor("camera"),
    signal: cameraEnabled && cameraSeen && measuringCamera,
    signalSettled: cameraSettled && measuringCamera,
    answer: cameraSaidYes,
  });
  const micStage = checkStage({
    passed: micChecked,
    problem: problemFor("microphone"),
    signal: micEnabled && measuringMic && micPeakRef.current > MIC_SILENT_PEAK,
    signalSettled: micSettled && measuringMic,
    answer: micSaidYes,
  });
  const stages: Record<CheckedDevice, CheckStage> = { camera: cameraStage, microphone: micStage };
  /**
   * The steps under one row, in priority order.
   *
   * Switched off outranks everything: a guest who muted themselves, or turned
   * their camera off, must not be told the device is broken and handed a list of
   * replacements. That was the shape of the first version — the camera had this
   * case and the microphone did not — which is why it is one function for both
   * rows rather than a condition written twice.
   *
   * Then a named fault, whose own message the row prints and whose steps the
   * guide over the preview is already walking them through. Then ours.
   */
  const stepsFor = (
    device: CheckedDevice,
    enabled: boolean,
    checked: boolean,
    stage: CheckStage,
  ): readonly string[] => {
    if (deviceOffBlocksEntry({ enabled, passed: checked })) return offSteps(device);
    if (problemFor(device)) return [];
    return checkCopy(device, stage).steps;
  };

  const gateOpen = !checkRequired || entryAllowed(stages);
  const gateReason = checkRequired ? blockedReason(stages) : null;

  // Latching is a render-time decision taken in an effect, because it is state:
  // the stage is derived, and the whole point of the latch is that it outlives
  // the thing that produced it.
  useEffect(() => {
    if (shouldLatch(cameraStage, cameraChecked)) setCameraChecked(true);
  }, [cameraStage, cameraChecked]);
  useEffect(() => {
    if (shouldLatch(micStage, micChecked)) setMicChecked(true);
  }, [micStage, micChecked]);

  const choose = (kind: DeviceKind, deviceId: string) => {
    rememberDevice(kind, deviceId);
    if (kind === "videoinput") setCamId(deviceId);
    else if (kind === "audioinput") setMicId(deviceId);
    else setSpeakerId(deviceId);
  };

  const join = () => {
    if (!canPressJoin(admission)) return;
    // Guarded here as well as on the button. The button being disabled is a
    // presentation detail; this is the rule, and a guest who has not proved
    // their devices does not get past it however the press arrived.
    if (!gateOpen) return;
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

  // The one problem big enough to cover the preview, and the rest, which stay
  // beside the Join button where they always were.
  const lead = leadProblem(problems);
  const guide = lead ? problemGuide(lead, browser) : null;
  const otherProblems = lead ? problems.filter((p) => p !== lead) : problems;

  // Clear what the browser last said and ask again. Denied first: both device
  // effects stand down while a device is marked denied, and a person who has
  // just allowed it in the address bar is the reason to ask.
  const retryDevices = () => {
    setCameraDenied(false);
    setMicDenied(false);
    setCameraBusy(false);
    setMicBusy(false);
    setRetryKey((k) => k + 1);
  };

  // A picker problem — the echo risk, a dead or busy microphone, a busy camera —
  // is fixed in the pickers, so it opens them, unless the person has already
  // chosen whether they are open.
  const devicesNeedAttention = Boolean(echoWarning) ||
    problems.some((p) => p.kind === "mic_silent" || p.kind === "mic_busy" || p.kind === "camera_busy");
  const devicesOpen = devicesOpenChoice ?? devicesNeedAttention;
  const summary = deviceSummary(devices, { cameraId: camId, micId, cameraEnabled });

  return (
    // Two columns from `md`: the preview large on the left, everything to decide
    // on the right. The old screen was one 384px column, so the preview — the
    // thing people actually check — was the size of a playing card on a laptop.
    <div className="mx-auto flex min-h-[70vh] w-full max-w-5xl items-center px-4 py-6 md:px-6">
      <div className="grid w-full gap-5 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] md:items-center md:gap-8">
        <div className="flex flex-col gap-3">
          {/* Preview */}
          <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-black shadow-sm aspect-video">
            {videoTrack && cameraEnabled ? (
              <BackgroundPreview
                track={videoTrack}
                effect={bgEffect}
                image={bgImage}
                onUnavailable={onBackgroundUnavailable}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1.5">
                <span className="text-white/60"><CamGlyph off /></span>
                <span className="text-xs text-white/60">
                  {cameraDenied ? "Camera blocked" : cameraEnabled ? "No camera" : "Camera off"}
                </span>
              </div>
            )}

            {/* A device that cannot be used at all, said where people are
                looking — over the picture that is not there — with the steps for
                this browser and a way to ask again without reloading. */}
            {guide && (
              <div
                role="alert"
                className="absolute inset-0 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
              >
                <div className="w-full max-w-sm text-white">
                  <p className="text-sm font-semibold sm:text-base">{guide.title}</p>
                  {guide.steps.length > 0 && (
                    <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-xs leading-snug text-white/80 sm:text-sm">
                      {guide.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                  <button
                    type="button"
                    onClick={retryDevices}
                    className="mt-3 min-h-11 rounded-lg bg-white px-4 text-sm font-semibold text-[#0d0d10] transition-opacity hover:opacity-90 sm:min-h-9"
                  >
                    {guide.actionLabel}
                  </button>
                </div>
              </div>
            )}

            {/* Mic + camera toggles, over the preview the way a call has them.
                44px on a phone, the size a thumb finds without looking. */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2">
              <button
                type="button"
                onClick={() => setMicEnabled((v) => !v)}
                disabled={micDenied || mics.length === 0}
                title={micEnabled ? "Join muted" : "Join unmuted"}
                aria-label={micEnabled ? "Join muted" : "Join unmuted"}
                aria-pressed={micEnabled}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-40 sm:h-10 sm:w-10 ${
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
                aria-label={cameraEnabled ? "Join with camera off" : "Join with camera on"}
                aria-pressed={cameraEnabled}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-40 sm:h-10 sm:w-10 ${
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
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-40 sm:h-10 sm:w-10 ${
                  bgEffect.kind !== "none" ? "bg-[var(--gold-400)] text-white" : "bg-white/15 text-white hover:bg-white/25"
                }`}
              >
                <BackgroundGlyph />
              </button>
            </div>

            {/* Live level, so "is my mic working" is answered before the call */}
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/50 px-2.5 py-1.5 backdrop-blur-sm">
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
                  className="min-h-9 px-1 text-xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
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
        </div>

        {/* Join card */}
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)]">
          <div className="flex flex-col gap-4 px-5 pb-4 pt-5">
            <h2 className="font-display text-lg font-semibold text-[var(--fg-primary)]">
              {checking
                ? "Check your camera & mic"
                : waitCopy && admission !== "failed" && admission !== "gave-up" ? "Almost in" : isHost ? "Ready to start?" : "Ready to join?"}
            </h2>

            {checking ? (
              <p className="text-xs text-[var(--fg-muted)]">
                Nobody can see or hear this. Talk to watch the meter move, and try a background.
              </p>
            ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--fg-muted)]">Your name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-base text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] sm:text-sm"
              />
            </label>
            )}

            {otherProblems.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {otherProblems.map((p) => (
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

            {/* The required check, for a guest. Above the Join button it gates
                and above the device pickers it sends them to, because a row that
                says "pick another microphone" with the pickers somewhere else on
                the screen is an instruction nobody can follow. */}
            {checkRequired && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-[var(--fg-secondary)]">
                  Check your camera and mic
                </p>
                <ul className="flex flex-col gap-1.5">
                  <CheckRow
                    device="camera"
                    stage={cameraStage}
                    message={problemFor("camera")?.message ?? null}
                    steps={stepsFor("camera", cameraEnabled, cameraChecked, cameraStage)}
                    onAnswer={(yes) => setCameraSaidYes(yes)}
                  />
                  <CheckRow
                    device="microphone"
                    stage={micStage}
                    message={problemFor("microphone")?.message ?? null}
                    steps={stepsFor("microphone", micEnabled, micChecked, micStage)}
                    onAnswer={(yes) => setMicSaidYes(yes)}
                  />
                </ul>
              </div>
            )}

            {/* Devices, folded to one line. Most people never change them, and
                three dropdowns above the Join button made the screen look like a
                settings page. A problem the pickers can fix opens them. */}
            <div className="rounded-lg border border-[var(--line)]">
              <button
                type="button"
                onClick={() => setDevicesOpenChoice(!devicesOpen)}
                aria-expanded={devicesOpen}
                aria-controls="green-room-devices"
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left sm:min-h-9"
              >
                <span className="shrink-0 text-xs font-medium text-[var(--fg-secondary)]">Devices</span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg-muted)]">{summary}</span>
                <svg
                  aria-hidden="true"
                  width="10" height="10" viewBox="0 0 8 8" fill="none"
                  className={`shrink-0 text-[var(--fg-muted)] transition-transform ${devicesOpen ? "rotate-180" : ""}`}
                >
                  <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>

              {/* Kept mounted while folded: the choices are live state, and the
                  pickers are what an assistive-technology user finds by label. */}
              <div
                id="green-room-devices"
                hidden={!devicesOpen}
                // The class as well as the attribute: `flex` outranks the
                // browser's own [hidden] rule, and left alone drew an empty box.
                className={`${devicesOpen ? "flex" : "hidden"} flex-col gap-2 border-t border-[var(--line)] px-3 py-3`}
              >
                {cameras.length > 0 && (
                  <label className="flex items-center gap-2">
                    <span className="shrink-0 text-[var(--fg-muted)]"><CamGlyph /></span>
                    <span className="sr-only">Camera</span>
                    <select
                      value={camId}
                      onChange={(e) => choose("videoinput", e.target.value)}
                      className="min-h-11 min-w-0 flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] sm:min-h-0 sm:text-xs"
                    >
                      {cameras.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                    </select>
                  </label>
                )}

                {mics.length > 0 && (
                  <label className="flex items-center gap-2">
                    <span className="shrink-0 text-[var(--fg-muted)]"><MicGlyph /></span>
                    <span className="sr-only">Microphone</span>
                    <select
                      value={micId}
                      onChange={(e) => choose("audioinput", e.target.value)}
                      className="min-h-11 min-w-0 flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] sm:min-h-0 sm:text-xs"
                    >
                      {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                    </select>
                  </label>
                )}

                {speakers.length > 0 && (
                  <label className="flex items-center gap-2">
                    <span className="shrink-0 text-[var(--fg-muted)]"><SpeakerGlyph /></span>
                    <span className="sr-only">Speaker</span>
                    <select
                      value={speakerId}
                      onChange={(e) => choose("audiooutput", e.target.value)}
                      className="min-h-11 min-w-0 flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] sm:min-h-0 sm:text-xs"
                    >
                      {speakers.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                    </select>
                  </label>
                )}

                {/* Echo, before anybody can hear it.
                    This is the better of the two places to say it: here nothing
                    is live, so the member can change the device without a room
                    full of people listening to themselves while they work it out.
                    The room says the same thing on a mid-call switch, because
                    that path exists too. */}
                {echoWarning && (
                  <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                    <span className="shrink-0">🔊</span>
                    <span>{echoWarning}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* The button's slot becomes the wait. Nothing above it moves, so the
              preview does not re-render and every control stays usable.

              Pinned to the bottom of a phone screen: below the preview and the
              card, Join was a scroll away on the screen whose only job is to
              get somebody into the call. */}
          <div className="sticky bottom-0 z-10 border-t border-[var(--line)] bg-[var(--surface-1)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 md:static">
            {checking ? (
              <a
                href="/meetings"
                className="flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--gold-400)] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--gold-500)]"
              >
                Done
              </a>
            ) : waitCopy ? (
              <WaitStatus
                admission={admission}
                title={waitCopy.title}
                detail={waitCopy.detail}
                cancelLabel={waitCopy.cancelLabel}
                onCancel={onCancelAdmission}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={join}
                  disabled={joining || !gateOpen}
                  className="min-h-11 w-full rounded-lg bg-[var(--gold-400)] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--gold-500)] disabled:opacity-50"
                >
                  {joinLabel}
                </button>
                {/* Names the device that is actually in the way. "Check your
                    devices", in front of somebody whose camera is fine and whose
                    microphone is not, costs them the next two minutes. */}
                {gateReason && (
                  <p className="mt-2 text-center text-[11px] text-[var(--fg-muted)]">{gateReason}</p>
                )}
              </>
            )}
          </div>

          {/* The meeting's own link, ready to hand to whoever is missing. A
              rehearsal has no meeting, so nothing to share. */}
          {checking ? null : (
            <div className="rounded-b-2xl border-t border-[var(--line)] bg-[var(--surface-0)] px-5 py-3">
              <MeetingShareLink roomCode={roomCode} title={meetingTitle} scheduledAt={scheduledAt} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The states that are a wait in progress, and so get a running clock. */
const TIMED_WAITS: ReadonlySet<AdmissionUiState> = new Set(["waiting", "busy", "timed-out"]);

/**
 * The Join button's slot, while someone waits to be let in.
 *
 * Says how long it has been. A wait with no clock reads as a page that has
 * stopped working, and two minutes without one is when people reload — which
 * puts them at the back of the queue. Its own component so the second hand
 * re-renders this line, not the preview above it.
 */
function WaitStatus({
  admission, title, detail, cancelLabel, onCancel,
}: {
  admission: AdmissionUiState;
  title: string;
  detail: string;
  cancelLabel: string | null;
  onCancel?: () => void;
}) {
  const timed = TIMED_WAITS.has(admission);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timed) { setSince(null); return; }
    setSince((s) => s ?? Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timed]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-center"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${admission === "timed-out" ? "bg-[var(--status-warning)]" : "bg-[var(--gold-400)] animate-pulse"}`}
        />
        <span className="text-sm font-semibold text-[var(--fg-primary)]">{title}</span>
      </div>
      <p className="text-xs text-[var(--fg-muted)]">{detail}</p>
      {/* Not inside the live region's text: a screen reader announcing the
          seconds would read every one of them. */}
      {timed && since !== null && (
        <p aria-hidden="true" className="font-mono text-[11px] tabular-nums text-[var(--fg-muted)]">
          Waiting {waitedLabel(now - since)}
        </p>
      )}
      {cancelLabel && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="min-h-9 px-2 text-xs text-[var(--fg-muted)] underline underline-offset-2 transition-colors hover:text-[var(--status-danger)]"
        >
          {cancelLabel}
        </button>
      )}
    </div>
  );
}
