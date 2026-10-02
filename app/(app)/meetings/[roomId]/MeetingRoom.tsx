"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { handsUpLabel, raisedBy } from "@/lib/meetings/hands";
import {
  REACTION_VISIBLE_MS,
  activeReactions,
  normalizeReaction,
  withoutReaction,
  type ReactionState,
} from "@/lib/meetings/reactions";
import { MeetingGreenRoom, type GreenRoomChoice } from "./MeetingGreenRoom";
import {
  constraintsFor,
  facingConstraints,
  releaseStream,
  settledFacing,
  displayConstraints,
  levelFromSamples,
  needsSinkChange,
  smoothLevel,
} from "@/lib/meetings/devices";
import {
  ECHO_DETECTED_NOTICE,
  createEchoWatch,
  echoRisk,
  echoRiskNotice,
  observeEcho,
  type EchoWatch,
} from "@/lib/meetings/echo";
import {
  createReturnWatch,
  observeVoiceReturn,
  voiceReturnNotice,
  type ReturnWatch,
} from "@/lib/meetings/voice-return";
import {
  LOCAL_SPEAKER_ID,
  SPEAKING_LEVEL,
  VoiceActivityLog,
  attributeUtterance,
  formatTranscriptLine,
  speakingIds,
  type ParticipantAudio,
} from "@/lib/meetings/speaker-attribution";
import {
  deliveryFromSendResult,
  displayNameFor,
  insertMessage,
  markDelivery,
  mergeChat,
  normalizeChatText,
  resolveTimestamp,
  type ChatDelivery,
  type ChatMessage,
  type ChatTurn,
} from "@/lib/meetings/chat";
import { CopilotErrorBoundary } from "./CopilotErrorBoundary";
import {
  BACKGROUND_PREF_KEY,
  NO_BACKGROUND,
  decodeEffect,
  encodeEffect,
  needsSegmentation,
  sameEffect,
  shouldSuspendEffect,
  suspensionMessage,
  type BackgroundEffect,
} from "@/lib/meetings/backgrounds";
import {
  MAX_BATCH,
  nextBatch,
  nextFlushDelay,
  pendingLines,
  speakerNames,
  transcriptRows,
} from "@/lib/meetings/transcript-buffer";
import { recordingNotice, type RecordingState } from "@/lib/meetings/recording-policy";
import {
  NO_ELAPSED,
  elapsedSeconds,
  monotonicNow,
  startSpan,
  stopSpan,
  type ElapsedState,
} from "@/lib/meetings/elapsed";
import { useRecording } from "@/lib/meetings/use-recording";
import { RecordingComposer, type ComposerHandlers, type RoomSnapshot } from "@/lib/meetings/recording-composer";
import type { MaskDriver } from "@/lib/meetings/mask-driver";
import { getBackground } from "@/lib/meetings/background-store";
import {
  camButtonTitle,
  micButtonTitle,
  participationNotice,
  standingOf,
  toggleCanDeliver,
} from "@/lib/meetings/participation";
import {
  canExit,
  isAwaitingReport,
  isCallRunning,
  nextPhase,
  type CallPhase,
} from "@/lib/meetings/call-phase";
import { PARTICIPANT_CONFLICT_TARGET, attendanceRecord } from "@/lib/meetings/attendance";
import {
  DISCONNECT_GRACE_MS,
  canSetLocalOffer,
  connectionStateFromIce,
  INITIAL_LINK,
  INITIAL_RECOVERY,
  contentHintFor,
  isPolite,
  msUntilNextAttempt,
  nextRecovery,
  offerCollision,
  peerConfig,
  shouldForceRelay,
  peerLinkStatus,
  recordAttempt,
  recoveryExhausted,
  withImmediateRetry,
  screenSendCap,
  stepLink,
  summarizeInbound,
  withOpusResilience,
} from "@/lib/meetings/connection";
import {
  type BandwidthMode,
  type LinkState,
  type PeerLinkStatus,
  type PeerInboundRate,
  type RecoveryState,
  type SendCap,
} from "@/lib/meetings/connection";
import {
  formatTransceivers,
  looksLikeMissingVideo,
  summarizeTransceivers,
  videoSenderNeedsRepair,
  type TransceiverState,
} from "@/lib/meetings/media-repair";
import {
  allocateSendCaps,
  scaleForCapture,
  FULL_CAPTURE,
  THUMBNAIL_CAPTURE,
  THUMBNAIL_SCALE,
  capTierForMode,
  tierForView,
  withDemotionDelay,
  DEMOTION_LINGER_MS,
  type VideoTier,
} from "@/lib/meetings/send-tiers";
import {
  effectiveLayout,
  layoutIsForced,
  screenSharerId,
  stageFocusId,
} from "@/lib/meetings/stage";
import { knockAlert } from "@/lib/meetings/knock-notice";
import { rememberDevice, rememberedDevice } from "@/lib/meetings/device-prefs";
import {
  acquisitionMessage,
  cameraMessage,
  planPreviewAdoption,
  type MediaFailure,
  type PreviewFacts,
} from "@/lib/meetings/media-acquisition";
import {
  CAMERA_CHECK_MS,
  cameraVerdict,
  needsRepair,
  repairFor,
} from "@/lib/meetings/camera-liveness";
import { watchFor } from "@/lib/meetings/device-reacquire";
import { startReacquire } from "@/lib/meetings/reacquire-loop";
import { openCallMedia, openCameraOnly, type OpenedMedia } from "@/lib/meetings/open-media";
import { resolveGuestKey } from "@/lib/meetings/guest-key";
import { createAdmissionSession, type AdmissionSession } from "@/lib/meetings/admission-session";
import { ADMISSION_NUDGE, admissionChannelName } from "@/lib/meetings/admission-channel";
import { admissionStatusFromResponse, retryAfterMs } from "@/lib/meetings/admission-poll";
import { isAdmissionLive, type AdmissionUiState } from "@/lib/meetings/admission-ui";
import { REMOVAL_NUDGE, removalChannelName } from "@/lib/meetings/removal-channel";
import { subjectFor, subjectKey, type RemovalSubject } from "@/lib/meetings/removal";
import {
  NO_DECISIONS,
  PRESENCE_GRACE_MS,
  applyAdmissionChange,
  forgetDecided,
  presentOnly,
  pruneDecided,
  rememberDecided,
  toEntry,
  withoutDecided,
  type AdmissionChange,
  type DecidedIds,
  type WaitingRow,
} from "@/lib/meetings/waiting-room";
import {
  GuestThanksScreen,
  NotAdmittedScreen,
  WaitingRoomBar,
  type WaitingPeer,
} from "./WaitingScreens";
import nextDynamic from "next/dynamic";
import {
  BodyPortal,
  FloatingMenu,
  notificationPermission,
  playChime,
  requestHostNotifications,
  createSpeakingStore,
  SpeakingProvider,
  useStableHandlers,
  audioTrackOf,
  videoTrackOf,
  type RemovedPerson,
} from "./room-shared";
// The call screen's pieces load as their own chunk, fetched while the member is
// in the green room (see the preload in MeetingRoom) rather than before the
// green room can be drawn.
//
// Held as a module in state rather than through next/dynamic. A lazy component
// suspends on its first render even when its chunk is already here, and with
// no boundary of its own that suspended the whole page on every join — the
// call blanked for a beat — and a failed chunk reached the route's error
// boundary and took a live call down with it.
type CallPartsModule = typeof import("./CallParts");
let callPartsModule: CallPartsModule | null = null;
let callPartsPromise: Promise<CallPartsModule> | null = null;
function loadCallParts(): Promise<CallPartsModule> {
  if (callPartsModule) return Promise.resolve(callPartsModule);
  if (!callPartsPromise) {
    callPartsPromise = import("./CallParts")
      .then((m) => (callPartsModule = m))
      .catch((err) => { callPartsPromise = null; throw err; });
  }
  return callPartsPromise;
}

/** Attempts at the call-screen chunk before offering a manual retry. */
const CALL_PARTS_ATTEMPTS = 3;

// Loaded when someone picks a background, not with the room: the picker and
// the processor behind it are code most calls never run, and the segmenter
// they drive was already fetched on demand.
const BackgroundPicker = nextDynamic(
  () => import("./BackgroundPicker").then((m) => m.BackgroundPicker),
  { ssr: false, loading: () => <p className="px-1 py-2 text-xs text-[var(--fg-muted)]">Loading backgrounds…</p> },
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Peer { id: string; displayName: string; stream: MediaStream | null }


// A transcript line carries who said it, not just what a microphone heard.
// `speakerId` is the signaling id — stable across a rename and identical on
// every participant's screen — so the name shown can be resolved live from the
// roster rather than frozen at the moment the words were spoken. `userId` is
// the signed-in account behind that id, absent for guests.
interface TranscriptLine {
  id: string;
  speakerId: string;
  speaker: string;
  userId: string | null;
  text: string;
  ts: number;
  final: boolean;
  isLocal: boolean;
  /** 0-1 attribution confidence, carried into the saved transcript and report. */
  confidence: number;
  /** Someone else was audible at the same time. */
  overlapped: boolean;
}

type SignalMsg =
  | { type: "join"; from: string; displayName: string }
  | { type: "leave"; from: string }
  | { type: "end"; from: string }
  | { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit; displayName?: string }
  | { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit; displayName?: string }
  | { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit }
  | {
      type: "transcript";
      from: string;
      speaker: string;
      userId?: string | null;
      text: string;
      ts: number;
      confidence?: number;
      overlapped?: boolean;
    }
  // Mic state has to be told, not measured: a muted track is simply silent, and
  // silence is indistinguishable from a listener who hasn't spoken yet.
  | { type: "mic"; from: string; micOn: boolean; displayName?: string }
  // Consent, not telemetry. Several US states require every party to a
  // conversation to know it is being recorded, and the host's own screen
  // knowing is not that — so the room is told, and every participant shows the
  // same badge from the same signal.
  | { type: "recording"; from: string; recording: boolean; by?: string }
  // The same argument for video, which used to be inferred from the pixels: a
  // camera turned off sends black frames rather than nothing, and a stream the
  // network has paused freezes on its last frame. Both look like a bug and
  // neither is, so each participant says which one it is.
  // `sharing` matters only to the recording: a shared screen takes the whole
  // frame there, and without this the composer can only recognise the HOST's
  // own share — a guest presenting slides would be composited as a small tile
  // of their slides, which is the one thing the recording exists to capture.
  | { type: "video"; from: string; camOn: boolean; paused: boolean; sharing?: boolean }
  // `id` is the sender's own message id, carried so every participant files
  // the message under the same key: it dedupes a retry of a message that did
  // in fact go out, it breaks the tie when two people send in the same
  // millisecond, and it is the primary key of the row the message is stored
  // as. Optional, so a client on an older build still chats.
  | { type: "chat"; from: string; displayName: string; text: string; ts: number; id?: string }
  | { type: "raise_hand"; from: string; raised: boolean }
  | { type: "reaction"; from: string; emoji: string; ts: number }
  | { type: "mute_all"; from: string }
  | { type: "kick"; from: string; target: string }
  | { type: "admit_request"; from: string; displayName: string }
  | { type: "admit"; from: string; target: string }
  | { type: "deny"; from: string; target: string }
  // Diagnostics for one-way media. A peer that is connected and receiving no
  // video asks the far end what its side of the connection looks like, because
  // the answer is not visible locally: `getTransceivers()` describes THIS
  // browser's senders and receivers, so a guest staring at a blank tile can see
  // that nothing is arriving and cannot see whether the host ever attached a
  // track to send. Only that snapshot separates "they never sent" from "the
  // direction negotiated one-way", and only the far end holds it.
  //
  // Reply content is used for a console line and nothing else — it is a peer's
  // self-report, not a fact this client acts on.
  // What one participant needs from another, so a sender can encode per peer
  // rather than sending everyone the same picture. See lib/meetings/send-tiers.
  | { type: "video_request"; from: string; to: string; tier: VideoTier }
  | { type: "media_probe"; from: string; to: string }
  | { type: "media_report"; from: string; to: string; transceivers: TransceiverState[] }
;

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_ICE: RTCConfiguration = peerConfig([
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]);

/**
 * A live track in the terms planPreviewAdoption reasons about.
 *
 * `getSettings()` rather than what was requested, because those differ exactly
 * when it matters: a request for the system default resolves to a concrete
 * device, and adopting on the strength of the request would be adopting without
 * having checked anything.
 */
function factsOf(track: MediaStreamTrack | null): PreviewFacts | null {
  if (!track) return null;
  try {
    return { deviceId: track.getSettings().deviceId || "", readyState: track.readyState };
  } catch {
    // A track that will not describe itself is not one to adopt on faith.
    return null;
  }
}

/**
 * How long one attempt at the ICE config may take before it is given up on.
 *
 * The signalling path waits on this fetch, and a request that is never answered
 * is never rejected — so without a deadline a black-holing proxy is a member
 * sitting in a meeting that never delivers them a single message.
 */
const ICE_FETCH_TIMEOUT_MS = 4000;

// How long a connected peer is given to start delivering video before the
// connection is described in the console. Long enough that a normal call never
// trips it, short enough to still be on screen when somebody reports it.
const INBOUND_VIDEO_AUDIT_MS = 8_000;
// How long the "this meeting is being recorded" notice stays up. Long enough to
// read twice without hurrying, short enough not to become furniture — the badge
// in the control bar is what carries the fact for the rest of the call.
const RECORDING_NOTICE_MS = 8_000;
// Voice metering: fast enough that a short "yes" leaves samples behind for
// attribution, slow enough not to compete with rendering for the main thread.
const VOICE_SAMPLE_MS = 120;

/**
 * How long someone must be the loudest before the stage moves to them.
 *
 * Without it, two people talking over each other flipped the focus several
 * times a second: each flip re-rendered the room, swapped the big tile's video
 * and asked the new speaker's encoder for full quality, only to drop it again.
 */
const SPEAKER_SWITCH_MS = 1000;

/** A pause longer than this restarts the challenger's count; gaps between words are shorter. */
const SPEAKER_GAP_MS = 600;
// How long the copilot takes to slide away. Must match the duration-200 below:
// the panel unmounts on this timer, and unmounting early cuts the animation.
const COPILOT_SLIDE_MS = 200;
// How long a burst of admission events is allowed to coalesce before the host's
// waiting list is re-read to confirm it. Long enough that "Admit all" over a
// roomful is a single query, short enough to be invisible.
const RECONCILE_MS = 400;
// How often the host re-reads the waiting list when Realtime is not carrying it.
//
// The guest side has had a polling floor under its push for a while, because a
// socket can die quietly. The host side had none — and the host is the only
// person who can act on a knock. A host behind a proxy that eats WebSockets
// read the list once on joining and then never again: guests knocked, the panel
// stayed empty, and they waited out the timeout and gave up while the host sat
// there believing nobody had arrived.
//
// Ten seconds, and only while the subscription is NOT connected. Long enough
// that a normal meeting never pays for it, short enough that somebody at the
// door is seen rather than left there.
const WAITING_FALLBACK_MS = 10_000;
// Most knocks the host's panel will read at once.
//
// Not a product limit — a host cannot work a queue this long — but a bound, for
// the same reason every other read in the meeting stack has one: an unbounded
// select is cut off at PostgREST's `max_rows` with nothing to say so, and a
// knock costs an attacker a single request.
const WAITING_CAP = 200;
// How often the panel re-checks which waiting guests are still there.
//
// Presence is a timestamp on the row, so it goes stale on the clock rather than
// on an event: without a tick of its own the panel would keep showing somebody
// who stopped polling until the next unrelated re-read happened to arrive.
// A third of the grace window, so the panel is never more than that out of date.
const PRESENCE_TICK_MS = Math.floor(PRESENCE_GRACE_MS / 3);
/** One participant's audio, as the voice meter reads it. */
interface VoiceTap {
  id: string;
  /** The track this tap reads; a replaced track means a new tap. */
  track: MediaStreamTrack;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  buffer: Float32Array<ArrayBuffer>;
  smoothed: number;
}


// ─── Main component ───────────────────────────────────────────────────────────

export function MeetingRoom({ roomCode }: { roomCode: string }) {
  // Start fetching the call screen as soon as the room mounts: the member is
  // about to spend a few seconds in the green room checking their camera, and
  // that is exactly the time it takes to arrive.
  const [callParts, setCallParts] = useState<CallPartsModule | null>(() => callPartsModule);
  const [callPartsFailed, setCallPartsFailed] = useState(false);
  const [callPartsRetry, setCallPartsRetry] = useState(0);
  useEffect(() => {
    if (callParts) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryLoad = () => {
      loadCallParts()
        .then((m) => { if (!cancelled) { setCallParts(m); setCallPartsFailed(false); } })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt < CALL_PARTS_ATTEMPTS) timer = setTimeout(tryLoad, 1000 * attempt);
          else setCallPartsFailed(true);
        });
    };
    tryLoad();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [callParts, callPartsRetry]);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Memoized so effects that subscribe/query with it can list it as a stable
  // dependency without tearing down and recreating on every render.
  const supabase = useMemo(() => createClient(), []);

  // The attendance row this member owns for this meeting, set once the join
  // upsert lands and cleared when they leave. Null for a guest with no account,
  // and null if the upsert failed — in both cases there is no row to close.
  const attendeeRef = useRef<{ meetingId: string; userId: string } | null>(null);

  /**
   * Close the attendance row: mark when they left.
   *
   * Presence on the meetings list is "a row with no left_at", so leaving
   * without writing this would leave everyone counted as still in the room.
   *
   * Best-effort by nature: a request started from pagehide may not survive the
   * document, and a killed tab writes nothing at all. That is why presence also
   * carries a staleness ceiling (PRESENCE_STALE_MS) rather than trusting this
   * to always run.
   */
  const recordDeparture = useCallback(() => {
    const attendee = attendeeRef.current;
    if (!attendee) return;
    // Cleared first: leave, then end-for-all, then pagehide can all fire for one
    // departure, and three writes for one leaving is two too many.
    attendeeRef.current = null;
    void supabase
      .from("live_meeting_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("meeting_id", attendee.meetingId)
      .eq("user_id", attendee.userId)
      .is("left_at", null)
      .then(({ error }) => {
        if (error) console.warn("[meeting] departure not recorded", error.message);
      });
  }, [supabase]);

  // Local media
  const localStreamRef = useRef<MediaStream | null>(null);
  // The track the room should be seeing when nobody is sharing a screen. With a
  // background effect on this is the composited canvas track, not the camera —
  // which is what lets the screen-share restore below stay unaware of effects.
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  // The camera device itself, which feeds the processor. Kept apart from the
  // above because switching cameras has to rebuild the effect on the new device.
  const rawCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  // The same track as state, so the effect that watches for the camera dying
  // can re-attach when the camera changes. It cannot key off `localStream`:
  // with a background effect on, that stream carries the composited canvas and
  // the camera behind it is reachable only through this ref.
  const [rawCameraTrack, setRawCameraTrack] = useState<MediaStreamTrack | null>(null);
  // A device the join could not open, and why. Set only for a device the member
  // actually wanted, cleared the moment it is recovered or the member takes the
  // matter into their own hands. See the re-acquisition effects below.
  const [cameraToRecover, setCameraToRecover] = useState<MediaFailure | null>(null);
  const [micToRecover, setMicToRecover] = useState<MediaFailure | null>(null);
  // What the member asked for before the hardware had its say. A device that
  // comes back should come back the way they meant it to be, not switched on
  // because it happened to be recovered.
  const micIntentRef = useRef(true);
  // The same for the camera. Not `camOn`, which is false in exactly the broken
  // case this exists to catch — a camera that was wanted and did not open.
  const camWantedRef = useRef(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // Mirrors the user's intended camera state so the bandwidth-adaptation logic
  // can restore video without clobbering a manual camera-off.
  const camOnRef = useRef(true);
  const [shareOn, setShareOn] = useState(false);
  const [localName, setLocalName] = useState("You");
  const localNameRef = useRef("You");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  // Mirrored so the transcript flush can read it without being rebuilt — and so
  // the unload path, which runs after React has stopped re-rendering anything,
  // still knows which meeting it is saving.
  const meetingIdRef = useRef<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const isHostRef = useRef(false);

  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE);
  /** Resolves once iceConfigRef holds this deployment's real servers. */
  const iceReadyRef = useRef<Promise<void> | null>(null);
  /** Pending "is video actually arriving?" checks, one per peer. */
  const inboundAuditRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Peers with a camera re-attach already in flight, so two never race. */
  const repairInFlightRef = useRef<Set<string>>(new Set());
  /** What each peer has asked US to send them. Absent means "not yet said". */
  const requestedTierRef = useRef<Map<string, VideoTier>>(new Map());
  /** What we last asked each peer for, so only changes go on the wire. */
  const sentRequestRef = useRef<Map<string, VideoTier>>(new Map());
  /** When each peer was last genuinely wanted large, for the demotion linger. */
  const lastHighAtRef = useRef<Map<string, number>>(new Map());
  /** The single re-check that lands a held demotion once the linger expires. */
  const demoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the servers above actually include a TURN relay. Read when a peer
  // fails to connect, so the logs distinguish "this network needed a relay and
  // had none" from an ordinary blip.
  const relayAvailableRef = useRef(false);

  // Peers
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const peersDataRef = useRef<Map<string, Peer>>(new Map());
  const myIdRef = useRef<string>(crypto.randomUUID());
  // Separate from `myIdRef`: the peer id identifies this tab's WebRTC connection
  // and must not be reused, while the admission key identifies the *person* and
  // must be, so the host's decision survives a reload. Lazily initialised — the
  // ref argument is evaluated on every render, and this one touches storage.
  // The server is refusing knocks, so this guest is in no queue at all — see
  // admission-ui's "busy". Separate from waitingForAdmit because it is a
  // different claim about the world, not a different stage of the same one.
  const [admissionBusy, setAdmissionBusy] = useState(false);
  // The wait ran out its bound and stopped asking. See ADMISSION_MAX_WAIT_MS.
  const [waitingGaveUp, setWaitingGaveUp] = useState(false);
  const guestKeyRef = useRef<string | null>(null);
  if (guestKeyRef.current === null) {
    guestKeyRef.current = resolveGuestKey(
      roomCode,
      crypto.randomUUID(),
      typeof window === "undefined" ? null : window.localStorage,
    );
  }
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // ICE candidates can arrive before the matching remote description is applied;
  // buffer them per-peer and flush once setRemoteDescription resolves so early
  // trickled candidates aren't dropped (which caused calls that never connected).
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  // Ensures we broadcast our join / admit-request exactly once — the subscribe
  // callback fires on every status transition (including reconnects), which
  // would otherwise re-announce us and spawn duplicate offers.
  const announcedRef = useRef(false);

  // ── Per-peer negotiation bookkeeping ──────────────────────────────────────
  //
  // The senders are held rather than looked up. Every path that changes what
  // goes out used to search `pc.getSenders()` for one whose track was already
  // video — which finds nothing for someone who joined with their camera off,
  // so their screen share and their camera reached nobody, silently, with the
  // button lit and the local preview correct.
  const videoSenderRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const audioSenderRef = useRef<Map<string, RTCRtpSender>>(new Map());
  // Perfect negotiation: true between createOffer and setLocalDescription, when
  // an incoming offer would collide with ours but the signaling state does not
  // show it yet.
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  // Renegotiation is only wired up once a peer has completed its first exchange;
  // the initial offer is issued explicitly so a browser that fires
  // `negotiationneeded` late (or not at all) still connects.
  const negotiationArmedRef = useRef<Map<string, boolean>>(new Map());
  const recoveryRef = useRef<Map<string, RecoveryState>>(new Map());
  // When each peer's connection state last moved, so a momentary drop can be
  // held back from the screen for the grace period before it is called one.
  const connChangedAtRef = useRef<Map<string, number>>(new Map());
  const recoveryTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Peers whose opening burst of ICE restarts is spent, so their tile says
  // "Connection lost". Retries continue underneath it on a slow cadence — this
  // is what the room SAYS, not whether it is still trying.
  const peerLostRef = useRef<Set<string>>(new Set());
  const [peerStatus, setPeerStatus] = useState<Map<string, PeerLinkStatus>>(new Map());
  // Remote tracks arrive one at a time on their own transceivers. Keeping the
  // stream ourselves means the tile is handed one object for the life of the
  // peer, so a camera that arrives after the microphone doesn't re-attach the
  // <video> element (which flashes) and a missing msid can't leave a peer with
  // no stream at all.
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  // What each peer says about their own video, which pixels cannot tell us.
  const [peerVideo, setPeerVideo] = useState<Map<string, { camOn: boolean; paused: boolean; sharing: boolean }>>(new Map());
  // Read from the stats timer, which is created once.
  const peerVideoRef = useRef<Map<string, { camOn: boolean; paused: boolean; sharing: boolean }>>(new Map());
  // Who is presenting, by signaling id. Only the recording reads this: the live
  // room shows a share as ordinary video, but the recording gives it the frame.
  const sharingPeersRef = useRef<Set<string>>(new Set());

  // Transcript. A ref, not state: nothing on screen shows it (the flush, the
  // attribution and the report all read the ref), and as state every interim
  // speech result — several a second while anyone talks — re-rendered the
  // whole room to draw nothing.
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const recognitionRef = useRef<any>(null);
  const interimIdRef = useRef<string>(crypto.randomUUID());
  // Which of our own lines the database has confirmed. A SET of line ids, not a
  // position: remote lines splice into the middle of the transcript by when
  // they were spoken, so any index into it is invalidated the moment somebody
  // else says something — which is how the old high-water mark managed to skip
  // lines and re-send others in the same call.
  const savedLineIdsRef = useRef<Set<string>>(new Set());
  // Consecutive failed flushes, driving the backoff. Reset by any success.
  const flushFailuresRef = useRef(0);

  // Recording. `roomRecording` is what a GUEST knows — set from the host's
  // broadcast, not from any local state — so the badge is driven by the same
  // signal for everyone in the room rather than by who happens to be recording.
  const [roomRecording, setRoomRecording] = useState<{ by: string } | null>(null);
  // The one-time notice, distinct from the badge. The badge is permanent and
  // small; this is the sentence that makes sure nobody can say they did not
  // know. Shown when a recording STARTS and then withdrawn, because a notice
  // that stays on screen gets dismissed reflexively and a notice that
  // reappears gets ignored — the badge is what carries the fact afterwards.
  const [recordingNoticeOpen, setRecordingNoticeOpen] = useState(false);

  // Speaker awareness. The recognizer reports words; these report voices — who
  // has a live mic, who is actually audible, and who was audible while the words
  // now being finalized were spoken.
  const [peerMicOn, setPeerMicOn] = useState<Map<string, boolean>>(new Map());
  const peerMicOnRef = useRef<Map<string, boolean>>(new Map());
  /**
   * Who is talking, kept OUT of this component's state on purpose.
   *
   * The voice meter republishes this about three times a second in ordinary
   * conversation, and it is read only by leaves — the ring on a tile, the dot on
   * a sidebar row. As state it re-ran all 4,858 lines of this component for each
   * of those, measured at 2.3ms with eight people and 3.8ms with twenty-six, on
   * the thread that decodes the video. The store notifies only the ids whose
   * answer changed, so one person starting to talk costs one tile.
   *
   * Same trade MeetingClock made for the second hand, three times as often.
   */
  const speakingStore = useRef(createSpeakingStore()).current;
  const voiceLogRef = useRef(new VoiceActivityLog());
  const lastAudibleRef = useRef<Map<string, number>>(new Map());
  const micOnRef = useRef(true);
  // The signed-in account behind this client, so a transcript line survives a
  // rename and a report can tie words to a real person. Null for guests.
  const localUserIdRef = useRef<string | null>(null);


  // Utterance boundaries. The recognizer hands us a sentence after the fact, so
  // attribution needs the moment it started, not the moment it arrived.
  const utteranceStartRef = useRef<number | null>(null);

  // Whether speech recognition is capturing. There is no transcript tab any
  // more, so this lamp in the copilot header is the only sign that the meeting
  // is being recorded for its report — which makes it worth more, not less.
  const [srStatus, setSrStatus] = useState<"idle" | "active" | "error" | "unsupported">("idle");

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // Read by retryChat, which must not re-create itself every time somebody
  // speaks — a new identity on each message would re-run the panel's effects.
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const chatOpenRef = useRef(false);

  // Raise hand & reactions
  const [handRaised, setHandRaised] = useState(false);
  const handRaisedRef = useRef(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Record<string, ReactionState>>({});
  /**
   * The timer clearing each person's reaction.
   *
   * Held per sender so a second reaction cancels the first one's timer. The
   * version this replaces compared the EMOJI on the way out — "clear it if it
   * is still 👍" — so sending 👍 twice inside the window had the first timer
   * clear the second one early, and the reaction vanished about a second after
   * it appeared. Two different people were never the problem; one person
   * reacting twice always was.
   */
  const reactionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Waiting room
  const [waitingPeers, setWaitingPeers] = useState<WaitingPeer[]>([]);
  /**
   * Admissions the host has decided but the table may not carry yet.
   *
   * A ref, because it guards writes to `waitingPeers` rather than being
   * rendered: putting it in state would re-render the room on every decision for
   * something nothing displays. See lib/meetings/waiting-room.ts for why the
   * screen has to outrank the database for a moment.
   */
  const decidedRef = useRef<DecidedIds>(NO_DECISIONS);
  /**
   * The panel's current contents, for the handlers that need to read them.
   *
   * "Admit all" is a decision about the people the host can SEE, so it has to
   * name them — and it cannot read them out of a setState updater, because an
   * updater has to be pure and React is free to run it more than once.
   */
  const waitingPeersRef = useRef<WaitingPeer[]>([]);
  waitingPeersRef.current = waitingPeers;
  /**
   * Who the host has removed from this meeting.
   *
   * Shown so the removal can be undone. Before this change "Remove" lasted
   * until the person pressed reload, so a misclick corrected itself; now it is
   * a fact, and a fact with no way back would be a worse trap than the one it
   * replaced.
   */
  const [removedPeople, setRemovedPeople] = useState<RemovedPerson[]>([]);
  /**
   * Said out loud when a removal could not be recorded.
   *
   * The person is out of the call either way — the broadcast saw to that — but
   * whether they can come back is decided by a request that may have failed,
   * and a host watching the tile vanish has every reason to assume it did not.
   */
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  // Whether the host's admissions subscription is actually carrying events.
  // False starts the fallback poll below; see WAITING_FALLBACK_MS.
  const [waitingLive, setWaitingLive] = useState(false);

  // Layout
  const [layout, setLayout] = useState<"grid" | "speaker">("grid");
  // Mirrors for refreshVideoRequests, which runs from a visibility listener and
  // from effects and must see the current view without being rebuilt by it.

  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  // ── The stage ─────────────────────────────────────────────────────────────
  //
  // Derived here rather than in the render body because the video-request path
  // reads it from refs, and those refs have to be current before the effect
  // that fires that path — an effect declared further down would run after it
  // and spend a whole round asking for the wrong thing.
  //
  // What this fixes: `sharingPeers` was tracked, broadcast and kept current,
  // and read by nothing but the recording composer. The live room drew a shared
  // screen as one grid cell the size of a face, and the spotlight followed the
  // audio meter — so a presenter who paused to take a question lost the big
  // tile to the person asking. See lib/meetings/stage.ts.
  const sharerId = useMemo(
    () => screenSharerId({ localIsSharing: shareOn, localId: LOCAL_SPEAKER_ID, peers: peerVideo }),
    [shareOn, peerVideo],
  );
  const stageLayout = effectiveLayout(layout, sharerId);
  const stageFocus = stageFocusId({ screenSharerId: sharerId, activeSpeakerId });
  const stageLayoutRef = useRef<"grid" | "speaker">("grid");
  const stageFocusRef = useRef<string | null>(null);
  useEffect(() => { stageLayoutRef.current = stageLayout; }, [stageLayout]);
  useEffect(() => { stageFocusRef.current = stageFocus; }, [stageFocus]);

  // Bandwidth adaptation
  const [bwMode, setBwMode] = useState<BandwidthMode>("normal");
  // Read from inside the processor's frame callback, which is created once.
  const bwModeRef = useRef<BandwidthMode>("normal");
  const bwCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The streak of good/bad samples behind the mode. Held apart from it because
  // a single measurement is not evidence — see stepLink.
  const linkRef = useRef<LinkState>(INITIAL_LINK);
  // Mirrors `shareOn` for the send-cap logic, which runs from timers and event
  // handlers created once.
  const shareOnRef = useRef(false);

  // Media error (permission denial, no devices, etc.)
  const [mediaError, setMediaError] = useState<string | null>(null);
  /**
   * Whether this member is actually being seen and heard.
   *
   * Derived, never stored, which is the point: a notice about a device that is
   * still missing cannot be dismissed into the background, and one about a
   * device that has come back disappears without anything having to remember to
   * clear it. `participation.ts` owns what each combination means.
   */
  const micStanding = useMemo(
    () => standingOf({
      present: (localStream?.getAudioTracks().length ?? 0) > 0,
      enabled: micOn,
      failure: micToRecover,
    }),
    [localStream, micOn, micToRecover],
  );
  const camStanding = useMemo(
    () => standingOf({
      present: (localStream?.getVideoTracks().length ?? 0) > 0,
      enabled: camOn,
      failure: cameraToRecover,
    }),
    [localStream, camOn, cameraToRecover],
  );
  const participation = useMemo(
    () => participationNotice(micStanding, camStanding),
    [micStanding, camStanding],
  );
  /**
   * The microphone's standing, for the toggle.
   *
   * A ref mirror because `toggleMic` is created once and reads refs — the same
   * pattern as `micOnRef` and `shareOnRef` beside it. Through the ref the
   * toggle asks `toggleCanDeliver` rather than re-deriving "is there a track",
   * so there is one tested answer to that question instead of two that can
   * drift.
   */
  const micStandingRef = useRef(micStanding);
  useEffect(() => { micStandingRef.current = micStanding; }, [micStanding]);

  // ── Camera backgrounds ────────────────────────────────────────────────────
  const [bgEffect, setBgEffect] = useState<BackgroundEffect>(NO_BACKGROUND);
  const bgEffectRef = useRef<BackgroundEffect>(NO_BACKGROUND);
  const maskRef = useRef<MaskDriver | null>(null);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [bgUnavailable, setBgUnavailable] = useState(false);
  const [bgNotice, setBgNotice] = useState<string | null>(null);
  const bgBtnRef = useRef<HTMLButtonElement>(null);
  // Sticky once tripped. A background that switched itself off and then back on
  // as the numbers wobbled would be worse than either state.
  const bgSuspendedRef = useRef(false);
  // Guards the async build below: two quick picks would otherwise each start a
  // driver, and the loser would keep a camera tap and a render loop alive.
  const maskBuildingRef = useRef(false);
  /**
   * The room is gone. Checked by anything that opens hardware across an await.
   *
   * `maskRef.current?.destroy()` in the teardown paths only reaches a driver
   * that has already been assigned, and a build in flight has not been. The
   * driver clones the camera the moment it hands over -- a clone is an
   * independent track, so stopping the original does not stop it -- which means
   * a build that completed after teardown left a camera capturing, with its
   * light on, for a call that had ended, and no reference left to stop it with.
   *
   * `BackgroundProcessor` never cloned, so this arrived with the driver.
   */
  const tornDownRef = useRef(false);
  /**
   * How many timing reports the worker has sent, to thin them out in the log.
   *
   * The number this whole change was started for -- the ~520KB GPU-to-CPU mask
   * readback, 24 times a second -- cannot be obtained from CI or from a
   * container without a GPU, because MediaPipe falls back to software rendering
   * and measures something else entirely. It needs one real call on real
   * hardware, and logging is what makes it readable there without shipping a
   * debug panel nobody asked for.
   */
  const maskReportsRef = useRef(0);

  // UI
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [copilotMounted, setCopilotMounted] = useState(true);
  const copilotUnmountRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * How long the meeting has been live, as spans rather than a running count.
   *
   * A ref, not state: nothing in this component needs to re-render when a second
   * passes. The clock in the control bar is its own leaf and ticks itself, and
   * the report reads the total once, at the end. It used to be
   * `useState(0)` advanced by a one-second interval, which re-rendered this
   * entire component and every video tile in the call once a second for the
   * length of the meeting — and undercounted, because a counter lands on the
   * number of callbacks rather than on the time.
   */
  const elapsedRef = useRef<ElapsedState>(NO_ELAPSED);
  const [ready, setReady] = useState(false);
  // Leaving is a lifecycle, not an instant. Ending posts a transcript to a model
  // that can take up to two minutes, and the call is already torn down by then —
  // so without a phase the screen sits on frozen video with a live-looking button
  // and reads as a hung app. "ending" drives the progress overlay and disables
  // the controls; "failed" drives the retry dialog; "left" holds the guest upsell.
  const [callPhase, setCallPhase] = useState<CallPhase>("live");
  // Read synchronously by the click handlers to reject a second press before any
  // state update has been committed.
  const endingRef = useRef(false);
  // Mirrors `callPhase` for the click handlers, which have to decide before a
  // state update has been committed.
  const callPhaseRef = useRef<CallPhase>("live");
  const previewStreamRef = useRef<MediaStream | null>(null);
  // How the green room is told the call has taken its tracks over, so it stops
  // stopping them. See planPreviewAdoption and MeetingGreenRoom's `release`.
  const releasePreviewRef = useRef<(() => void) | null>(null);
  /** A capture change already in flight, so the re-run it triggers cannot loop. */
  const captureRetuneRef = useRef(false);
  /**
   * The capture height last asked of a given camera.
   *
   * Kept per track, because a different camera has different modes: one that
   * cannot do 360p says nothing about the next one plugged in.
   */
  const captureAskedRef = useRef<{ track: MediaStreamTrack; height: number } | null>(null);
  /**
   * The call has taken the preview's tracks.
   *
   * After that the green room must not be allowed to hand them back. It goes on
   * rendering for the moment before it unmounts, and its own state changes keep
   * firing `onPreviewStream` — so without this the room would file the adopted
   * microphone as a preview again, and the next teardown would stop the track
   * the member is currently talking into.
   */
  const adoptedPreviewRef = useRef(false);
  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [showGuestUpsell, setShowGuestUpsell] = useState(false);
  // Read from the signaling handlers, which must not be re-created (and the
  // channel re-subscribed) just because this flipped.
  const isGuestRef = useRef(false);
  const [meetingTitle, setMeetingTitle] = useState("Meeting");
  // Read at the moment the meeting ends, which is after the last render that
  // could have closed over the state.
  const meetingTitleRef = useRef("Meeting");
  useEffect(() => { meetingTitleRef.current = meetingTitle; }, [meetingTitle]);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  // Pre-join devices. The green room enumerates and picks; these hold what it
  // settled on, for the in-call speaker routing and device switcher.
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedCamId, setSelectedCamId] = useState("");
  // Read by startCamera, which must not be rebuilt every time the live camera
  // changes — it is the thing that changes it.
  const selectedCamIdRef = useRef("");
  useEffect(() => { selectedCamIdRef.current = selectedCamId; }, [selectedCamId]);
  // The same, for the microphone, read by the re-acquisition loop for the same
  // reason: it is what changes the live device, so it cannot depend on it.
  const selectedMicIdRef = useRef("");
  useEffect(() => { selectedMicIdRef.current = selectedMicId; }, [selectedMicId]);
  // A camera being opened from the button. Held so the control can say it is
  // working rather than looking like a press that did nothing: opening a camera
  // takes a moment, and longer when the first one tried is busy.
  const [camStarting, setCamStarting] = useState(false);
  // The screen picker is open. Same job as camStarting — it disables the button
  // so a second press cannot open a second picker — but it also has to be a ref,
  // because the guard is read inside an async callback that was created before
  // the state it would otherwise be reading.
  const [shareStarting, setShareStarting] = useState(false);
  const sharePendingRef = useRef(false);
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("");

  /**
   * Echo advice, kept apart from `mediaError` on purpose.
   *
   * A device that failed to open and "others can hear themselves" are different
   * kinds of thing: one is a failure, the other is advice about a room and a
   * pair of speakers. Sharing one slot would mean dismissing the echo notice
   * also dismissed a dead microphone, or that a camera failure silently replaced
   * the only hint anybody had about why the call sounded wrong.
   */
  const [echoNotice, setEchoNotice] = useState<string | null>(null);
  /** The detector's memory. Allocated once; `observeEcho` never grows it. */
  const echoWatchRef = useRef<EchoWatch>(createEchoWatch());
  /**
   * Peers whose audio is muted on THIS device because it was carrying the
   * member's own voice back — another device in the same room. See
   * voice-return.ts. Muting playback here is the whole fix: the member can hear
   * that person in the room, and nobody else's audio is touched.
   */
  const [sameRoomPeers, setSameRoomPeers] = useState<ReadonlySet<string>>(() => new Set());
  /** Peers the member un-muted by hand. Never muted automatically again. */
  const keepAudibleRef = useRef<Set<string>>(new Set());
  const returnWatchRef = useRef<ReturnWatch>(createReturnWatch());
  // Read synchronously by `enterRoom`, which runs in the same tick as the click
  // that produced the choice — a state update would not be visible to it yet.
  const joinChoiceRef = useRef<GreenRoomChoice | null>(null);

  // Waiting room state
  const [waitingForAdmit, setWaitingForAdmit] = useState(false);
  const [waitingTimedOut, setWaitingTimedOut] = useState(false);
  // Let in, and the room could not be entered. Not a stage of waiting: nothing
  // is polling behind it, so the screen has to offer the way back itself.
  const [admissionFailed, setAdmissionFailed] = useState(false);
  // The host said no. Its own screen, because the old answer to a deny was to
  // push the joiner at /meetings — which lives behind the app's auth wall, so an
  // invite-link guest was answered with a login page. Being turned away and
  // being asked to sign in are not the same message, and only one of them is
  // true.
  const [deniedByHost, setDeniedByHost] = useState(false);
  // Owns the knock/poll sequence for as long as this guest is outside. Stopping
  // it cancels its timers, drops its visibility listener, and prevents a request
  // already in flight from following through.
  const admissionSessionRef = useRef<AdmissionSession | null>(null);

  const clearWaitingTimers = useCallback(() => {
    admissionSessionRef.current?.stop();
    admissionSessionRef.current = null;
  }, []);

  /**
   * Take this guest's pending knock off the host's panel.
   *
   * Giving up used to be entirely local: the session stopped, the screen went
   * back to Join, and the row stayed `waiting` forever. There is no TTL on that
   * table and nothing sweeps it, so the host went on seeing somebody who had
   * left — in the panel, in the toolbar count, and in the system notification
   * that fires when that count rises — and admitting them reached nobody.
   *
   * Best-effort by construction, and never awaited into anything a person is
   * watching: failing to withdraw leaves exactly the stale row we had before,
   * which is not worth holding up a screen the guest is walking away from.
   * `keepalive` so the unload path survives the document going away.
   */
  const withdrawKnock = useCallback((opts: { keepalive?: boolean } = {}) => {
    const key = guestKeyRef.current;
    if (!key || !isGuestRef.current) return;
    try {
      void fetch(`/api/meetings/public/${roomCode}/knock?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        keepalive: opts.keepalive === true,
      }).catch(() => { /* the row stays; the host can still deny it */ });
    } catch { /* same */ }
  }, [roomCode]);

  /**
   * The meeting is over. Signed-in people get the report; a guest cannot read it
   * (it is inside the signed-in app) so they get the thank-you rather than the
   * login page that a push at the report URL would actually produce.
   */
  const leaveEndedMeeting = useCallback(() => {
    clearWaitingTimers();
    previewStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    setWaitingForAdmit(false);
    setJoining(false);
    if (isGuestRef.current) { setShowGuestUpsell(true); return; }
    router.push(`/meetings/${roomCode}/report`);
  }, [clearWaitingTimers, router, roomCode]);

  /**
   * Stop waiting, and go back to the screen they are already looking at.
   *
   * Deliberately not `leaveMeeting`: that tears the call down, which stops the
   * preview stream the green room is still showing — so cancelling a knock
   * would blank the guest's own camera and cost them their setup. Nothing here
   * was ever started except the admission session, so nothing else is stopped.
   * They land back on Join, with their camera, microphone and background exactly
   * as they left them, and can ask again with one press.
   */
  const cancelAdmission = useCallback(() => {
    clearWaitingTimers();
    // Tell the host, rather than only ourselves. See withdrawKnock.
    withdrawKnock();
    setAdmissionBusy(false);
    setWaitingGaveUp(false);
    setWaitingForAdmit(false);
    setWaitingTimedOut(false);
    // Also the way back from a failed entry: the copy's "Try again" is this
    // button, and it has to clear the state that put it there.
    setAdmissionFailed(false);
    setJoining(false);
  }, [clearWaitingTimers, withdrawKnock]);

  /** Leave the waiting room because the host declined. */
  const showDenied = useCallback(() => {
    clearWaitingTimers();
    previewStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    setWaitingForAdmit(false);
    setWaitingTimedOut(false);
    setAdmissionFailed(false);
    setJoining(false);
    setDeniedByHost(true);
  }, [clearWaitingTimers]);

  // The call is joined, admitted, and not being torn down. Every periodic effect
  // watches this rather than `ready` alone, so leaving or ending stops them all
  // at once instead of leaving timers running against a dead call.
  const sessionLive = ready && !waitingForAdmit && isCallRunning(callPhase);

  // What the pre-join screen shows in place of its Join button. "asking" is the
  // knock's round trip — brief, but without it the button would sit there
  // looking pressable while the request was in the air.
  const admissionUi: AdmissionUiState =
    admissionFailed ? "failed"
    // Ordered by how much each claim overrides the one below it. "gave-up" is
    // terminal, so it outranks the copy-only timeout. "busy" outranks both of
    // the waiting states because it contradicts them: a refused knock inserted
    // no row, so there is no queue to be timing out of.
    : waitingGaveUp ? "gave-up"
    : admissionBusy && (waitingForAdmit || joining) ? "busy"
    : waitingTimedOut ? "timed-out"
    : waitingForAdmit ? "waiting"
    : joining && !isHost ? "asking"
    : "idle";

  /**
   * Broadcast, and report whether the socket accepted it.
   *
   * `channel.send()` has always resolved to "ok", "timed out" or "error", and
   * this room has always thrown that away. For most signals that is the right
   * trade — a `mic` state that misses is corrected by the next one, and an
   * `ice` candidate that misses is one of many. Chat has no next one: it is
   * typed once, by a person, who is then shown their own words and left to
   * assume the room saw them.
   *
   * A null channel is a failure rather than a silent no-op for the same
   * reason. `teardownCall` nulls it, and the optional chain used to turn
   * "there is no socket" into "sent".
   */
  const sendSignalAck = useCallback(async (msg: SignalMsg): Promise<ChatDelivery> => {
    const channel = channelRef.current;
    if (!channel) return "failed";
    try {
      return deliveryFromSendResult(
        await channel.send({ type: "broadcast", event: "signal", payload: msg }),
      );
    } catch {
      return "failed";
    }
  }, []);

  // Every other signal keeps the fire-and-forget shape it had, over the same
  // one transport — so there is no second way for a message to leave the room.
  const sendSignal = useCallback((msg: SignalMsg) => { void sendSignalAck(msg); }, [sendSignalAck]);

  const sendSignalRef = useRef(sendSignal);
  useEffect(() => { sendSignalRef.current = sendSignal; }, [sendSignal]);
  useEffect(() => { localNameRef.current = localName; }, [localName]);
  useEffect(() => { chatMessagesRef.current = chatMessages; }, [chatMessages]);
  useEffect(() => { peersDataRef.current = peers; }, [peers]);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { handRaisedRef.current = handRaised; }, [handRaised]);
  useEffect(() => { callPhaseRef.current = callPhase; }, [callPhase]);
  useEffect(() => { bwModeRef.current = bwMode; }, [bwMode]);
  // Nothing is transmitted while the camera is off, so nothing needs compositing.
  // A screen share is the same case wearing a different hat: the composited
  // canvas goes neither to the peers nor to the local tile while the screen
  // holds the video sender, so segmenting for it is a warm fan and nothing else.
  useEffect(() => { maskRef.current?.setPaused(!camOn || shareOn); }, [camOn, shareOn]);

  // A call already dropping video to protect audio should not be spending the
  // remaining budget on scenery. The CPU half of this rule is applied from
  // inside the processor's frame loop; both defer to shouldSuspendEffect.
  useEffect(() => {
    if (bgSuspendedRef.current || !needsSegmentation(bgEffectRef.current)) return;
    const decision = shouldSuspendEffect({ bwMode, consecutiveSlowFrames: 0 });
    if (!decision.suspend || !decision.reason) return;
    bgSuspendedRef.current = true;
    setBgNotice(suspensionMessage(decision.reason));
    void applyBackgroundRef.current(NO_BACKGROUND);
  }, [bwMode]);
  useEffect(() => { peerMicOnRef.current = peerMicOn; }, [peerMicOn]);
  useEffect(() => { peerVideoRef.current = peerVideo; }, [peerVideo]);

  // Teardown on unmount. If the user navigates away via client-side routing
  // (browser back, a nav link, the guest "leave" link) instead of clicking
  // Leave/End, this releases the camera + mic, closes every peer connection, and
  // unsubscribes the realtime channel — otherwise the camera light stays on and
  // the channel/peers leak after the room is gone. Reads only refs, so [] is safe.
  useEffect(() => {
    // These Map refs are created once and never reassigned, so capturing them
    // here is equivalent to reading `.current` at cleanup and keeps the linter
    // happy. Streams/channel/recognition refs ARE reassigned after join, so we
    // read those live at teardown time.
    const peerConnections = peersRef.current;
    const pendingIce = pendingIceRef.current;
    const recoveryTimers = recoveryTimerRef.current;
    const copilotUnmount = copilotUnmountRef;
    const mask = maskRef;
    const rawCamera = rawCameraTrackRef;
    const tornDown = tornDownRef;
    return () => {
      // First: everything below releases what EXISTS, and this is what stops
      // anything still being built from being adopted after it.
      tornDown.current = true;
      try { peerConnections.forEach((pc) => pc.close()); } catch { /* ignore */ }
      peerConnections.clear();
      pendingIce.clear();
      recoveryTimers.forEach((t) => clearTimeout(t));
      recoveryTimers.clear();
      try { channelRef.current?.unsubscribe(); } catch { /* ignore */ }
      if (recognitionRef.current) {
        try { recognitionRef.current.onend = null; recognitionRef.current.stop(); } catch { /* ignore */ }
      }
      localStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      previewStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      if (copilotUnmount.current) clearTimeout(copilotUnmount.current);
      mask.current?.destroy();
      try { rawCamera.current?.stop(); } catch { /* already stopped */ }
    };
  }, []);

  // ── createPeerConnection ─────────────────────────────────────────────────

  /** Forget everything held about one peer, without touching the connection. */
  const forgetPeerState = useCallback((peerId: string) => {
    pendingIceRef.current.delete(peerId);
    connChangedAtRef.current.delete(peerId);
    videoSenderRef.current.delete(peerId);
    audioSenderRef.current.delete(peerId);
    makingOfferRef.current.delete(peerId);
    negotiationArmedRef.current.delete(peerId);
    recoveryRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
    peerLostRef.current.delete(peerId);
    // A peer who left is not still presenting. Without this a recording keeps
    // the whole frame given to a screen share whose owner has gone.
    sharingPeersRef.current.delete(peerId);
    const timer = recoveryTimerRef.current.get(peerId);
    if (timer) { clearTimeout(timer); recoveryTimerRef.current.delete(peerId); }
    // A peer that left owes no explanation for video that never arrived.
    const audit = inboundAuditRef.current.get(peerId);
    if (audit) { clearTimeout(audit); inboundAuditRef.current.delete(peerId); }
    repairInFlightRef.current.delete(peerId);
    requestedTierRef.current.delete(peerId);
    sentRequestRef.current.delete(peerId);
    lastHighAtRef.current.delete(peerId);
  }, []);

  /**
   * Point the camera at what is actually being drawn, and say what it is on now.
   *
   * Returns the capture height to size the encoders against — which is the
   * CURRENT one, not the one being asked for, because applyConstraints takes a
   * moment and a scale computed against a resolution the camera has not reached
   * yet would be wrong for exactly as long as that takes. The re-run when it
   * lands is what picks up the new size.
   *
   * Only the raw camera is touched. The processed track a background effect
   * sends is a canvas that follows the camera's dimensions on its own, so
   * constraining the camera shrinks the segmentation work too.
   */
  const retuneCapture = useCallback((caps: ReadonlyMap<string, SendCap | null>): number | null => {
    const camera = rawCameraTrackRef.current;
    if (!camera || camera.readyState !== "live") return null;

    let settings: MediaTrackSettings;
    try { settings = camera.getSettings(); } catch { return null; }
    const current = settings.height ?? null;

    // Derived from the caps rather than from the requests, so one rule decides
    // both: anything asking for more than a thumbnail keeps the camera up.
    const wantsFull = [...caps.values()].some((c) => c !== null && c.scaleResolutionDownBy < THUMBNAIL_SCALE);
    const target = wantsFull ? FULL_CAPTURE : THUMBNAIL_CAPTURE;

    // Asked for once per camera per target, and not again unless something
    // moves. `ideal` is a request, not a requirement: a camera with no 360p mode
    // resolves the promise and stays at 720p — so a re-run that only checked the
    // height would find the same gap, ask again, and spin applyConstraints
    // forever on exactly the hardware that cannot satisfy it.
    const asked = captureAskedRef.current;
    const alreadyAsked = asked?.track === camera && asked.height === target.height;

    if (current !== target.height && !alreadyAsked && !captureRetuneRef.current) {
      captureRetuneRef.current = true;
      captureAskedRef.current = { track: camera, height: target.height };
      void camera
        .applyConstraints({
          width: { ideal: target.width },
          height: { ideal: target.height },
          frameRate: { ideal: target.frameRate, max: target.frameRate },
        })
        .catch(() => { /* a camera with no such mode keeps the one it has */ })
        .finally(() => {
          captureRetuneRef.current = false;
          // Only when the camera actually moved. Re-running on a camera that
          // ignored the request is the loop this guard exists to prevent, and
          // there is nothing new to size the encoders against anyway.
          let settled: number | null = null;
          try { settled = camera.getSettings().height ?? null; } catch { /* gone */ }
          if (settled !== current) applySendCapsRef.current();
        });
    }
    return current;
  }, []);

  /**
   * Push the current send budget onto every video sender.
   *
   * This is the whole answer to a mesh call that sounds like it is underwater.
   * Without a cap each participant hands the encoder 720p30 and lets it spend
   * whatever it likes, once per peer — four people is four uploads from one
   * laptop — and the first thing that gives way when the uplink is oversold is
   * not the picture but the audio sharing the path with it.
   *
   * `active: false` rather than disabling the track: it stops the RTP stream at
   * the sender while leaving the camera, the local preview and the camera
   * button exactly as the member left them.
   */
  const applySendCaps = useCallback(() => {
    const sharing = shareOnRef.current;
    const wanted = sharing || camOnRef.current;
    const ids = [...videoSenderRef.current.keys()];

    // A shared screen is the thing everyone is looking at, so it is not sized
    // per viewer — it keeps the even split and full resolution. A camera is the
    // opposite: in a presented meeting most people are a 96px thumbnail on
    // every other screen, and sending them a sixth of the budget at half
    // resolution spends the upload, and the encoder, on detail that is drawn
    // four times smaller than it is sent.
    const caps: Map<string, SendCap | null> = !wanted
      ? new Map(ids.map((id) => [id, null]))
      : sharing
        ? new Map(ids.map((id) => [id, screenSendCap(ids.length, bwModeRef.current)]))
        : allocateSendCaps(requestedTierRef.current, ids, bwModeRef.current);

    // Move the CAMERA to match the largest thing anyone asked for, not just the
    // encoders. Sizing the encoders alone still leaves a laptop capturing 720p
    // thirty times a second and scaling each frame down four times over for
    // four thumbnails — real CPU, and on a phone real battery, spent producing
    // detail that is thrown away before it reaches the wire. A screen share is
    // exempt: its size is the thing being read.
    const captureHeight = sharing ? null : retuneCapture(caps);

    videoSenderRef.current.forEach((sender, peerId) => {
      const cap = caps.get(peerId) ?? null;
      let params: RTCRtpSendParameters;
      try { params = sender.getParameters(); } catch { return; }
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const enc = params.encodings[0];
      if (cap) {
        enc.active = true;
        enc.maxBitrate = cap.maxBitrate;
        // Corrected for the capture actually in effect. The caps are divisors
        // written against 720p, so applying one unchanged to a 360p capture
        // would halve the picture a second time — see scaleForCapture.
        enc.scaleResolutionDownBy = captureHeight === null
          ? cap.scaleResolutionDownBy
          : scaleForCapture(cap.scaleResolutionDownBy, captureHeight);
        enc.maxFramerate = cap.maxFramerate;
      } else {
        enc.active = false;
      }
      // A shared screen should lose frames before it loses legibility; a face
      // is the other way round.
      params.degradationPreference = sharing ? "maintain-resolution" : "balanced";
      void sender.setParameters(params).catch(() => { /* older engines reject some fields */ });
    });
  }, [retuneCapture]);
  const applySendCapsRef = useRef(applySendCaps);
  useEffect(() => { applySendCapsRef.current = applySendCaps; }, [applySendCaps]);

  /**
   * Tell each peer what size we are drawing them at.
   *
   * The saving this unlocks is not marginal. In a presented meeting with six
   * guests, five of six people are a 96px thumbnail on every screen in the
   * room — and were being sent a sixth of the upload budget at half resolution
   * each. Asking for a thumbnail instead takes their outgoing video from
   * 2.4Mbps across six full-size encoders to about 1Mbps across six quarter-
   * resolution ones, and hands what that frees to whoever is actually being
   * watched.
   *
   * Only changes go on the wire, and the tier comes from the LAYOUT rather than
   * from measuring an element: a tile's size changes continuously while a
   * window is dragged, and quality that followed it would renegotiate on every
   * frame of the drag.
   */
  const refreshVideoRequests = useCallback(() => {
    const ids = [...peersRef.current.keys()];
    const hidden = typeof document !== "undefined" && document.hidden;
    const now = Date.now();
    // Including ourselves: the grid draws our own tile too, and it is the total
    // that decides how small each one is.
    const tileCount = ids.length + 1;
    let holding = false;
    for (const id of ids) {
      const said = peerVideoRef.current.get(id);
      const desired = tierForView({
        documentHidden: hidden,
        // The STAGE's spotlight, not the audio meter's: a peer sharing their
        // screen is what the room is looking at, and asking them for a
        // thumbnail of it is asking for an unreadable one.
        isSpotlight: stageLayoutRef.current === "speaker" && stageFocusRef.current === id,
        layout: stageLayoutRef.current,
        tileCount,
        cameraOn: said ? said.camOn && !said.paused : true,
      });
      if (desired === "high") lastHighAtRef.current.set(id, now);
      const held = withDemotionDelay({
        desired,
        lastHighAt: lastHighAtRef.current.get(id) ?? null,
        now,
      });
      // A tier that is only `high` because of the linger has to be revisited,
      // or the demotion never lands: nothing else in the room changes when a
      // timer expires. Decided before the bandwidth cap below, which is not a
      // held promotion and does not expire.
      if (held !== desired) holding = true;
      // What a struggling line may ask for. Everything above decides what we
      // WANT to draw; this is the first point at which what we can afford to
      // receive has ever been consulted — see capTierForMode.
      const tier = capTierForMode(held, bwModeRef.current);
      if (sentRequestRef.current.get(id) === tier) continue;
      sentRequestRef.current.set(id, tier);
      sendSignalRef.current({ type: "video_request", from: myIdRef.current, to: id, tier });
    }

    // One timer for the whole room rather than one per peer: they all expire
    // within the same linger, and a single re-check re-evaluates every peer.
    if (demoteTimerRef.current) { clearTimeout(demoteTimerRef.current); demoteTimerRef.current = null; }
    if (holding) {
      demoteTimerRef.current = setTimeout(() => {
        demoteTimerRef.current = null;
        refreshVideoRequestsRef.current();
      }, DEMOTION_LINGER_MS);
    }
  }, []);
  const refreshVideoRequestsRef = useRef(refreshVideoRequests);
  useEffect(() => { refreshVideoRequestsRef.current = refreshVideoRequests; }, [refreshVideoRequests]);

  /** Tell the room what our video is doing, so nobody has to guess from pixels. */
  const announceVideoState = useCallback(() => {
    sendSignalRef.current({
      type: "video",
      from: myIdRef.current,
      camOn: camOnRef.current || shareOnRef.current,
      paused: bwModeRef.current === "audio-only",
      sharing: shareOnRef.current,
    });
  }, []);
  const announceVideoStateRef = useRef(announceVideoState);
  useEffect(() => { announceVideoStateRef.current = announceVideoState; }, [announceVideoState]);

  /** Recompute one peer's badge from its live connection state. */
  const refreshPeerStatus = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    const status: PeerLinkStatus = pc
      ? peerLinkStatus(
          // Not every engine reports `connectionState`; the ICE state is always
          // there and says the same thing about whether media can flow.
          pc.connectionState ?? connectionStateFromIce(pc.iceConnectionState),
          Date.now() - (connChangedAtRef.current.get(peerId) ?? 0),
          peerLostRef.current.has(peerId),
        )
      : "lost";
    setPeerStatus((prev) => {
      if (prev.get(peerId) === status) return prev;
      const next = new Map(prev);
      next.set(peerId, status);
      return next;
    });
  }, []);
  const refreshPeerStatusRef = useRef(refreshPeerStatus);
  useEffect(() => { refreshPeerStatusRef.current = refreshPeerStatus; }, [refreshPeerStatus]);

  /**
   * Try to bring a stalled connection back.
   *
   * `restartIce()` on its own does nothing: it marks the connection as wanting
   * fresh candidates and then waits for someone to renegotiate. There was no
   * `negotiationneeded` handler here, so nothing ever did — every call that lost
   * its path stayed frozen until somebody reloaded, which is the failure this
   * whole section exists to prevent.
   */
  const recoverPeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (!pc || pc.connectionState === "connected" || pc.connectionState === "closed") return;

    const state = recoveryRef.current.get(peerId) ?? INITIAL_RECOVERY;
    const now = Date.now();
    const action = nextRecovery(state, now);

    // Come back at the moment this peer is actually due, rather than polling.
    const sleepThenRetry = (delay: number) => {
      const existing = recoveryTimerRef.current.get(peerId);
      if (existing) clearTimeout(existing);
      recoveryTimerRef.current.set(peerId, setTimeout(() => {
        recoveryTimerRef.current.delete(peerId);
        recoverPeerRef.current(peerId);
      }, delay));
    };

    if (action === "give_up") {
      peerLostRef.current.add(peerId);
      refreshPeerStatusRef.current(peerId);
      return;
    }
    if (action === "wait") { sleepThenRetry(msUntilNextAttempt(state, now)); return; }

    const attempted = recordAttempt(state, now);
    recoveryRef.current.set(peerId, attempted);
    // Past the opening burst the member is told, because by now they have been
    // staring at a frozen tile for half a minute and deserve an answer. Being
    // told is all it is: the retries below go on regardless, which is the whole
    // difference between this and the version that stopped here for good.
    if (recoveryExhausted(attempted) && !peerLostRef.current.has(peerId)) {
      peerLostRef.current.add(peerId);
      refreshPeerStatusRef.current(peerId);
    }
    try { pc.restartIce(); } catch { /* not supported — the renegotiation below still helps */ }
    // Both ends can reach here at once; the collision handling in the offer
    // path is what keeps that from deadlocking.
    void renegotiateRef.current(peerId, { iceRestart: true });
    // Schedule the next attempt here rather than waiting to be called back by a
    // connection state change. A connection whose offers are going nowhere —
    // the signalling socket is down, the far end is asleep — may not emit
    // another state change at all, and that silence is exactly the case the
    // retries exist for.
    sleepThenRetry(msUntilNextAttempt(attempted, Date.now()));
  }, []);
  const recoverPeerRef = useRef(recoverPeer);
  useEffect(() => { recoverPeerRef.current = recoverPeer; }, [recoverPeer]);

  /** Make an offer for a peer, with Opus asked to protect itself on the way out. */
  const renegotiate = useCallback(async (peerId: string, options?: RTCOfferOptions) => {
    const pc = peersRef.current.get(peerId);
    if (!pc || pc.signalingState === "closed") return;
    try {
      makingOfferRef.current.set(peerId, true);
      const offer = await pc.createOffer(options);
      offer.sdp = withOpusResilience(offer.sdp ?? "");
      // The state can have moved under us while createOffer was in flight — but
      // only some states are a reason to stop. See canSetLocalOffer: an offer
      // that was never answered leaves the connection in `have-local-offer`
      // permanently, and that is precisely the connection an ICE restart is
      // trying to rescue.
      if (!canSetLocalOffer(pc.signalingState)) return;
      await pc.setLocalDescription(offer);
      sendSignalRef.current({ type: "offer", from: myIdRef.current, to: peerId, sdp: offer, displayName: localNameRef.current });
      negotiationArmedRef.current.set(peerId, true);
    } catch (e) {
      console.warn("[WebRTC] offer", e);
    } finally {
      makingOfferRef.current.set(peerId, false);
    }
  }, []);
  const renegotiateRef = useRef(renegotiate);
  useEffect(() => { renegotiateRef.current = renegotiate; }, [renegotiate]);

  /**
   * Make sure this peer's video sender is actually holding the camera.
   *
   * A sender whose track is missing or has ended keeps a perfectly healthy
   * connection: the m-line was negotiated, ICE succeeded, audio flows, and the
   * far end simply never receives a frame. Nothing in the connection reports
   * that, and no renegotiation fixes it, because from the connection's point of
   * view nothing is wrong.
   *
   * `replaceTrack` needs no renegotiation and is a no-op when the sender is
   * already correct, so this is safe to run on every connect. It deliberately
   * does NOT touch a disabled track: that is somebody's camera switched off,
   * and re-attaching would turn it back on for the whole room.
   */
  const repairOutgoingVideo = useCallback((peerId: string) => {
    // `connected` can fire more than once before a replaceTrack settles — an
    // ICE restart on a flapping link is the ordinary way — and two repairs
    // racing on one sender is worth avoiding even though the last writer wins.
    if (repairInFlightRef.current.has(peerId)) return;
    const sender = videoSenderRef.current.get(peerId);
    if (!sender) return;
    const local = localStreamRef.current?.getVideoTracks()[0] ?? null;
    if (!local || !videoSenderNeedsRepair(sender.track, local)) return;
    repairInFlightRef.current.add(peerId);
    console.warn(`[meeting] peer ${peerId} had no live outgoing video track — re-attaching the camera`);
    void sender
      .replaceTrack(local)
      .catch(() => { /* peer closed mid-repair */ })
      .finally(() => { repairInFlightRef.current.delete(peerId); });
  }, []);
  const repairOutgoingVideoRef = useRef(repairOutgoingVideo);
  useEffect(() => { repairOutgoingVideoRef.current = repairOutgoingVideo; }, [repairOutgoingVideo]);

  /**
   * Say what a connection is carrying when it claims to be healthy and isn't.
   *
   * Checked a few seconds after connecting rather than immediately, because
   * video legitimately lands a beat after audio and complaining at once would
   * cry wolf on every call. When it does fire it prints both sides of every
   * transceiver, which is the evidence that distinguishes "we never attached a
   * track" from "the direction came back one-way" — the two causes that produce
   * an otherwise perfect connection with one dark direction, and which are
   * impossible to tell apart after the call has ended.
   */
  const auditInboundVideo = useCallback((peerId: string) => {
    const existing = inboundAuditRef.current.get(peerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      inboundAuditRef.current.delete(peerId);
      const pc = peersRef.current.get(peerId);
      if (!pc) return;
      const stream = remoteStreamsRef.current.get(peerId);
      const said = peerVideoRef.current.get(peerId);
      const stale = looksLikeMissingVideo({
        connectionState: pc.connectionState ?? "connected",
        connectedForMs: Date.now() - (connChangedAtRef.current.get(peerId) ?? Date.now()),
        // Missing means "has not said otherwise", which the tiles already read
        // as camera-on; keep the two agreeing.
        peerSaysCameraOn: said ? said.camOn && !said.paused : true,
        hasInboundVideoTrack: (stream?.getVideoTracks().length ?? 0) > 0,
      });
      if (!stale) return;
      // OUR side of the connection. Necessary but not sufficient: this shows
      // our receiver (empty, which is the symptom) and our sender (fine, which
      // is not in question). Whether the far end ever attached a track to send
      // is not knowable from here, so ask — the reply is logged beside this.
      console.warn(
        `[meeting] peer ${peerId} is connected and says its camera is on, but no video is arriving. Our side: ${formatTransceivers(summarizeTransceivers(pc.getTransceivers()))}`,
      );
      sendSignalRef.current({ type: "media_probe", from: myIdRef.current, to: peerId });
    }, INBOUND_VIDEO_AUDIT_MS);
    inboundAuditRef.current.set(peerId, timer);
  }, []);
  const auditInboundVideoRef = useRef(auditInboundVideo);
  useEffect(() => { auditInboundVideoRef.current = auditInboundVideo; }, [auditInboundVideo]);

  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    // Close any prior connection for this peer first — a duplicate `join`
    // (reconnect / re-admit) would otherwise orphan the old RTCPeerConnection
    // (a leak) and start a competing offer/answer cycle.
    const prior = peersRef.current.get(peerId);
    if (prior) {
      try { prior.close(); } catch { /* ignore */ }
      // Only a connection being REPLACED carries stale senders, flags and
      // candidates. A first connection may already be holding candidates that
      // were trickled ahead of the offer, and those are the whole reason the
      // buffer exists — clearing them here would leave `flushPendingIce` with
      // nothing to apply and the connection checking against no remote
      // candidates at all.
      forgetPeerState(peerId);
    }

    const pc = new RTCPeerConnection(iceConfigRef.current);
    const local = localStreamRef.current;

    // Transceivers up front, in a fixed order, rather than whatever `addTrack`
    // happens to produce. Someone who joined with their camera off had no video
    // track to add and therefore no video sender either — so turning the camera
    // on, picking a background or sharing a screen replaced a track that did not
    // exist, and reached nobody. Declaring both directions here means the shape
    // of the connection never depends on what the hardware was doing at join.
    //
    // On the answering side these are adopted by the incoming offer's matching
    // m-sections, so this costs no extra round trip.
    const audioTrack = local?.getAudioTracks()[0] ?? null;
    const videoTrack = local?.getVideoTracks()[0] ?? null;
    const streams = local ? [local] : [];
    if (audioTrack) audioTrack.contentHint = contentHintFor("microphone");
    if (videoTrack) videoTrack.contentHint = contentHintFor(shareOnRef.current ? "screen" : "camera");

    const audioTx = pc.addTransceiver(audioTrack ?? "audio", { direction: "sendrecv", streams });
    const videoTx = pc.addTransceiver(videoTrack ?? "video", { direction: "sendrecv", streams });
    audioSenderRef.current.set(peerId, audioTx.sender);
    videoSenderRef.current.set(peerId, videoTx.sender);

    pc.ontrack = (ev) => {
      // Prefer the stream the far end named, so both sides agree on identity,
      // but never depend on it: a renegotiated or msid-less answer arrives with
      // an empty `streams`, which used to leave that peer with a null stream and
      // a permanently blank tile.
      let ms = remoteStreamsRef.current.get(peerId) ?? ev.streams[0] ?? null;
      if (!ms) ms = new MediaStream();
      remoteStreamsRef.current.set(peerId, ms);
      // A replaced track arrives as a new one on the same transceiver; drop the
      // old track of that kind rather than accumulating dead ones.
      ms.getTracks().forEach((t) => { if (t !== ev.track && t.kind === ev.track.kind) ms!.removeTrack(t); });
      if (!ms.getTracks().includes(ev.track)) ms.addTrack(ev.track);

      // Always a new Map, even when the stream object is unchanged: tracks
      // arrive one per transceiver, and the tile decides whether it has video by
      // reading the stream during render. Skipping the re-render on the second
      // track would leave a peer's camera hidden behind the "Camera off"
      // placeholder for the rest of the call.
      setPeers((prev) => {
        const existing = prev.get(peerId);
        const next = new Map<string, Peer>(prev);
        next.set(peerId, { id: peerId, displayName: existing?.displayName ?? peerId, stream: ms });
        return next;
      });
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendSignalRef.current({ type: "ice", from: myIdRef.current, to: peerId, candidate: ev.candidate.toJSON() });
    };

    // Renegotiation, which is what actually carries an ICE restart or a newly
    // added track. Armed only after the first exchange: the initial offer is
    // issued explicitly, and letting this fire for the transceivers above would
    // race it with a duplicate.
    pc.onnegotiationneeded = () => {
      if (!negotiationArmedRef.current.get(peerId)) return;
      if (pc.signalingState !== "stable") return;
      void renegotiateRef.current(peerId);
    };

    // The same signal one level down, for engines where `connectionState` is
    // absent or lags. Both handlers funnel into the same idempotent work.
    pc.oniceconnectionstatechange = () => {
      if (pc.connectionState !== undefined) return;
      connChangedAtRef.current.set(peerId, Date.now());
      refreshPeerStatusRef.current(peerId);
      if (pc.iceConnectionState === "failed") recoverPeerRef.current(peerId);
    };

    pc.onconnectionstatechange = () => {
      connChangedAtRef.current.set(peerId, Date.now());
      refreshPeerStatusRef.current(peerId);

      if (pc.connectionState === "connected") {
        // A connection that came back has spent none of its retries.
        recoveryRef.current.delete(peerId);
        peerLostRef.current.delete(peerId);
        const timer = recoveryTimerRef.current.get(peerId);
        if (timer) { clearTimeout(timer); recoveryTimerRef.current.delete(peerId); }
        // Encoder parameters do not survive a renegotiation on every engine.
        applySendCapsRef.current();
        announceVideoStateRef.current();
        // A connected peer is the moment to check that this connection is
        // carrying what it agreed to — see repairOutgoingVideo.
        repairOutgoingVideoRef.current(peerId);
        auditInboundVideoRef.current(peerId);
        return;
      }

      if (pc.connectionState === "failed") {
        // Name the most likely cause while the evidence is still here. A
        // connection that fails outright with no relay in the config is the
        // signature of a network that needed one — which is precisely how
        // invite-link guests used to fail, silently, having been refused TURN.
        if (!relayAvailableRef.current) {
          console.warn(`[meeting] peer ${peerId} failed with no TURN relay configured — a restrictive network cannot connect without one`);
        }
        recoverPeerRef.current(peerId);
        return;
      }

      if (pc.connectionState === "disconnected") {
        // Most of these repair themselves within a second or two — a Wi-Fi roam,
        // a phone changing cell. Look again after the grace period rather than
        // tearing down a connection that was about to come back, and rather than
        // flashing a badge nobody needed to see.
        const existing = recoveryTimerRef.current.get(peerId);
        if (existing) clearTimeout(existing);
        recoveryTimerRef.current.set(peerId, setTimeout(() => {
          recoveryTimerRef.current.delete(peerId);
          refreshPeerStatusRef.current(peerId);
          if (peersRef.current.get(peerId)?.connectionState === "disconnected") recoverPeerRef.current(peerId);
        }, DISCONNECT_GRACE_MS));
      }
    };

    peersRef.current.set(peerId, pc);
    connChangedAtRef.current.set(peerId, Date.now());
    // A newcomer changes what everyone else can afford to send.
    applySendCapsRef.current();
    return pc;
  }, [forgetPeerState]);

  // ── handleSignal ─────────────────────────────────────────────────────────

  // Upsert a peer's display name without disturbing its stream.
  const setPeerName = useCallback((peerId: string, name: string) => {
    setPeers((prev) => {
      const ex = prev.get(peerId);
      if (ex && ex.displayName === name) return prev;
      const next = new Map<string, Peer>(prev);
      next.set(peerId, { id: peerId, displayName: name, stream: ex?.stream ?? null });
      return next;
    });
  }, []);

  // Apply any ICE candidates buffered before the remote description was set.
  const flushPendingIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const buf = pendingIceRef.current.get(peerId);
    if (!buf || buf.length === 0) return;
    pendingIceRef.current.delete(peerId);
    for (const c of buf) { try { await pc.addIceCandidate(c); } catch { /* safe to ignore */ } }
  }, []);

  const handleSignal = useCallback(async (msg: SignalMsg) => {
    // Before anything is acted on, and uniformly rather than only in the
    // branches that build a connection: awaiting one shared promise releases
    // every waiter in the order it was queued, so the messages stay in the
    // order they arrived. Resolved for all but the first moments of a call —
    // see enterRoom, which now opens the socket and fetches the ICE config at
    // the same time instead of one after the other.
    if (iceReadyRef.current) await iceReadyRef.current;
    const myId = myIdRef.current;

    if (msg.type === "join" && msg.from !== myId) {
      playChime("join");
      // The door is the enforcement point — the knock route refuses a removed
      // subject before anything else — but the signalling channel has never
      // been gated by the waiting room, so a client that simply skipped the
      // knock could appear here. One request per join closes that.
      void checkRemovalsRef.current();
      setPeers((prev) => {
        const next = new Map<string, Peer>(prev);
        const existing = next.get(msg.from);
        next.set(msg.from, { id: msg.from, displayName: msg.displayName, stream: existing?.stream ?? null });
        return next;
      });
      createPeerConnection(msg.from);
      // The offer carries our name, so the newcomer labels our tile correctly.
      // Without it, a guest who joins after us only learns our identity via
      // `ontrack`, which falls back to our raw UUID.
      await renegotiateRef.current(msg.from);
      // Mic and camera state are only ever announced on change, so a newcomer
      // would assume everyone already in the room is unmuted and on camera.
      // Tell them where we actually are.
      sendSignalRef.current({ type: "mic", from: myId, micOn: micOnRef.current, displayName: localNameRef.current });
      announceVideoStateRef.current();
    }

    if (msg.type === "end") {
      endingRef.current = true;
      teardownCallRef.current();
      setCallPhase((prev) => nextPhase(prev, "remote_end"));
      if (isGuestRef.current) { setShowGuestUpsell(true); return; }
      router.push("/meetings");
      return;
    }

    if (msg.type === "leave" && msg.from !== myId) {
      playChime("leave");
      peersRef.current.get(msg.from)?.close();
      peersRef.current.delete(msg.from);
      forgetPeerState(msg.from);
      setPeerStatus((prev) => { if (!prev.has(msg.from)) return prev; const next = new Map(prev); next.delete(msg.from); return next; });
      setPeerVideo((prev) => { if (!prev.has(msg.from)) return prev; const next = new Map(prev); next.delete(msg.from); return next; });
      // One fewer upload to pay for.
      applySendCapsRef.current();
      setPeers((prev) => { const next = new Map<string, Peer>(prev); next.delete(msg.from); return next; });
      // Drop the departed peer's transient UI state so a stale ✋ / emoji doesn't linger.
      setRaisedHands((prev) => { if (!prev.has(msg.from)) return prev; const next = new Set(prev); next.delete(msg.from); return next; });
      clearReactionRef.current(msg.from);
      setPeerMicOn((prev) => { if (!prev.has(msg.from)) return prev; const next = new Map(prev); next.delete(msg.from); return next; });
      lastAudibleRef.current.delete(msg.from);
    }

    if (msg.type === "offer" && msg.to === myId) {
      let pc = peersRef.current.get(msg.from);
      // An offer arriving on a connection that has already failed is the far
      // end rebuilding their side, and applying it to the corpse of ours is how
      // a recovered network still produced a black tile. Rebuild to meet them —
      // createPeerConnection closes and forgets the old one on the way past.
      if (pc && (pc.connectionState === "failed" || pc.signalingState === "closed")) pc = undefined;
      if (!pc) pc = createPeerConnection(msg.from);
      // Record the offerer's name (e.g. the host) so guests don't see a UUID.
      if (msg.displayName) setPeerName(msg.from, msg.displayName);

      // Two ends can offer at the same moment — an ICE restart after a link
      // failed in both directions is the ordinary way it happens — and a
      // connection handed a remote offer while its own is outstanding throws.
      // Exactly one side backs down, decided from the peer ids so neither has to
      // ask.
      const action = offerCollision({
        signalingState: pc.signalingState,
        makingOffer: makingOfferRef.current.get(msg.from) === true,
        polite: isPolite(myId, msg.from),
      });
      if (action === "ignore") return;

      try {
        if (action === "rollback_then_accept" && pc.signalingState === "have-local-offer") {
          // Discard our own offer; theirs is the one that survives. Only when
          // there is one to discard: a collision detected while createOffer is
          // still in flight leaves the state stable, where a rollback throws.
          // Our own offer is abandoned instead by the stable check in
          // `renegotiate`, which will no longer hold once this offer is applied.
          await pc.setLocalDescription({ type: "rollback" });
        }
        makingOfferRef.current.set(msg.from, false);
        await pc.setRemoteDescription(msg.sdp);
        await flushPendingIce(msg.from, pc);
        const answer = await pc.createAnswer();
        answer.sdp = withOpusResilience(answer.sdp ?? "");
        await pc.setLocalDescription(answer);
        sendSignalRef.current({ type: "answer", from: myId, to: msg.from, sdp: answer, displayName: localNameRef.current });
        // From here a `negotiationneeded` is a real renegotiation rather than
        // the echo of the transceivers we set up above.
        negotiationArmedRef.current.set(msg.from, true);
        applySendCapsRef.current();
      } catch (e) { console.warn("[WebRTC] answer", e); }
    }

    if (msg.type === "answer" && msg.to === myId) {
      if (msg.displayName) setPeerName(msg.from, msg.displayName);
      const pc = peersRef.current.get(msg.from);
      if (pc) {
        try {
          await pc.setRemoteDescription(msg.sdp);
          await flushPendingIce(msg.from, pc);
          applySendCapsRef.current();
        } catch (e) { console.warn("[WebRTC] setRemote", e); }
      }
    }

    if (msg.type === "ice" && msg.to === myId) {
      const pc = peersRef.current.get(msg.from);
      // Only add once the remote description exists; otherwise buffer for flush.
      if (pc && pc.remoteDescription) {
        try { await pc.addIceCandidate(msg.candidate); } catch { /* safe to ignore */ }
      } else {
        const buf = pendingIceRef.current.get(msg.from) ?? [];
        buf.push(msg.candidate);
        pendingIceRef.current.set(msg.from, buf);
      }
    }

    if (msg.type === "transcript" && msg.from !== myId) {
      const line: TranscriptLine = {
        id: crypto.randomUUID(),
        speakerId: msg.from,
        speaker: msg.speaker,
        userId: msg.userId ?? null,
        text: msg.text,
        ts: msg.ts,
        final: true,
        isLocal: false,
        confidence: msg.confidence ?? 1,
        overlapped: msg.overlapped ?? false,
      };
      // Order by when the words were spoken, not when the packet landed. Two
      // people talking at once reach us out of order otherwise, and the notes
      // model then reads a conversation whose turns are shuffled.
      {
        const next = [...transcriptRef.current];
        // Step past the in-progress interim line, which always trails the
        // finals, then back through any final spoken after this one.
        let at = next.length;
        while (at > 0 && !next[at - 1].final) at--;
        while (at > 0 && next[at - 1].ts > line.ts) at--;
        next.splice(at, 0, line);
        transcriptRef.current = next;
      }
    }

    if (msg.type === "recording" && msg.from !== myId) {
      setRoomRecording(msg.recording ? { by: msg.by ?? "The host" } : null);
      return;
    }

    if (msg.type === "mic" && msg.from !== myId) {
      if (msg.displayName) setPeerName(msg.from, msg.displayName);
      setPeerMicOn((prev) => {
        if (prev.get(msg.from) === msg.micOn) return prev;
        const next = new Map(prev);
        next.set(msg.from, msg.micOn);
        return next;
      });
      // A mic that just went off is not "still speaking" — release the hold now
      // rather than letting it decay as if the voice merely paused.
      if (!msg.micOn) lastAudibleRef.current.delete(msg.from);
    }

    if (msg.type === "video_request" && msg.to === myId) {
      // A peer's own claim about what it is drawing. Validated rather than
      // trusted: this decides what we encode, and an unknown value would fall
      // through allocateSendCaps as "high" and quietly undo the saving.
      if (msg.tier !== "high" && msg.tier !== "low" && msg.tier !== "none") return;
      if (requestedTierRef.current.get(msg.from) === msg.tier) return;
      requestedTierRef.current.set(msg.from, msg.tier);
      applySendCapsRef.current();
      return;
    }

    if (msg.type === "media_probe" && msg.to === myId) {
      // Somebody is receiving no video from us. Describe our side of that
      // connection so the two snapshots can be read together.
      const pc = peersRef.current.get(msg.from);
      if (!pc) return;
      sendSignalRef.current({
        type: "media_report",
        from: myId,
        to: msg.from,
        transceivers: summarizeTransceivers(pc.getTransceivers()),
      });
      return;
    }

    if (msg.type === "media_report" && msg.to === myId) {
      // The half that was missing: what the far end thinks it is sending us.
      // `send=NO TRACK` here means they never attached a camera to this
      // connection; `got=recvonly` means the direction negotiated one-way.
      console.warn(`[meeting] peer ${msg.from} reports its side: ${formatTransceivers(msg.transceivers)}`);
      return;
    }

    if (msg.type === "video" && msg.from !== myId) {
      // Read by the recording composer, which needs it every frame and cannot
      // wait for a render. Kept in step with the state below rather than
      // derived from it.
      if (msg.sharing) sharingPeersRef.current.add(msg.from);
      else sharingPeersRef.current.delete(msg.from);
      const sharing = msg.sharing === true;
      setPeerVideo((prev) => {
        const ex = prev.get(msg.from);
        if (ex && ex.camOn === msg.camOn && ex.paused === msg.paused && ex.sharing === sharing) return prev;
        const next = new Map(prev);
        // `sharing` is carried in the render state as well as the ref: the ref
        // is read by the recording composer every frame, and the live stage
        // needs to re-render when it changes — which was exactly what it never
        // did. See lib/meetings/stage.ts.
        next.set(msg.from, { camOn: msg.camOn, paused: msg.paused, sharing });
        return next;
      });
    }

    if (msg.type === "chat" && msg.from !== myId) {
      // Every field is taken on our terms rather than theirs: the text is
      // bounded here as well as at the sender, the name comes from the roster
      // by signaling id rather than from the claim in the payload, and a
      // timestamp from a badly-set clock is replaced by our own arrival time.
      const text = normalizeChatText(msg.text);
      if (text) {
        const chatMsg: ChatMessage = {
          id: msg.id ?? crypto.randomUUID(),
          from: msg.from,
          displayName: displayNameFor(msg, peersDataRef.current),
          text,
          ts: resolveTimestamp(msg.ts, Date.now()),
        };
        // Placed by when it was SAID, not when it landed. Appending meant the
        // sender saw their line before the replies and everyone else saw it
        // after — one conversation rendered as several.
        setChatMessages((prev) => insertMessage(prev, chatMsg));
        if (!chatOpenRef.current) setChatUnread((n) => n + 1);
      }
    }

    if (msg.type === "raise_hand") {
      setRaisedHands((prev) => { const next = new Set(prev); if (msg.raised) next.add(msg.from); else next.delete(msg.from); return next; });
    }

    if (msg.type === "reaction" && msg.from !== myId) {
      showReactionRef.current(msg.from, msg.emoji);
    }

    if (msg.type === "mute_all" && msg.from !== myId) {
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      setMicOn(false);
      micOnRef.current = false;
      sendSignalRef.current({ type: "mic", from: myId, micOn: false, displayName: localNameRef.current });
    }

    if (msg.type === "kick" && msg.target === myId) {
      // ASKED, not obeyed. This message arrives on a channel anyone holding the
      // room code can publish to, so acting on it directly meant any
      // participant — or anyone a link was ever forwarded to — could eject
      // anybody from the call by sending one line. It predates this branch and
      // was never the host's authority; it only looked like it.
      //
      // So it is a hint to go and check, exactly as the admission nudge is:
      // checkRemovals asks the server which of the ids in this room have
      // actually been removed, and stands this client down only if the answer
      // includes its own. A forged kick now costs the forger one request by an
      // honest client and nothing else.
      void checkRemovalsRef.current();
      return;
    }

    // Waiting-room admission is now DB-backed (see the knock/admissions routes):
    // a waiting guest never joins this signaling channel until admitted, so
    // admit_request / admit / deny no longer travel over the WebRTC channel.

  }, [createPeerConnection, router, setPeerName, flushPendingIce, forgetPeerState]);

  // ── Detect host status on mount (pre-join screen label) ──────────────────

  useEffect(() => {
    async function detectHost() {
      // The user first, and the row only if there is one. Nobody signed out
      // hosts a meeting, so for an invite-link guest this query could never
      // return anything they could use — and it was issued on every load
      // regardless, competing for the connection with the public lookup and the
      // camera the green room is opening at the same moment. On a phone, on
      // someone else's network, that is the worst place to spend a round trip.
      //
      // The cost is that a signed-in host now makes these two calls in sequence
      // rather than together. That is a label on a button ("Start meeting"
      // rather than "Join meeting") on the one participant who is not the one
      // struggling to connect.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: meeting } = await supabase
        .from("live_meetings").select("host_id").eq("room_code", roomCode).maybeSingle();
      const m = meeting as { host_id: string } | null;
      if (m && user.id === m.host_id) {
        setIsHost(true);
        isHostRef.current = true;
      }
    }
    void detectHost();
  }, [roomCode, supabase]);

  // ── Preview camera ────────────────────────────────────────────────────────
  //
  // Owned by the green room now: it picks the device, meters the mic and hands
  // the stream up here so `enterRoom` can release it before opening the real
  // sending stream. Acquiring it in both places raced for the same camera.

  // ── Auto-join for guests arriving from invite link ────────────────────────

  useEffect(() => {
    const guestParam = searchParams.get("guest");
    const nameParam = searchParams.get("name");
    if (guestParam !== "1") return;
    setIsGuest(true);
    isGuestRef.current = true;
    // Recover name from URL param or sessionStorage fallback
    const storedName = typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem(`guest_name_${roomCode}`) ?? ""
      : "";
    const guestName = nameParam ? decodeURIComponent(nameParam) : storedName;
    if (guestName) setDisplayName(guestName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── joinMeeting ──────────────────────────────────────────────────────────

  // The real join: acquire camera/mic, subscribe to the signaling channel, and
  // announce ourselves. Called immediately for the host, and only AFTER the host
  // admits for everyone else — so a waiting guest never opens a sending stream or
  // touches the signaling channel until they're let in.
  const enterRoom = useCallback(async (mId: string | null, name: string) => {
    // Started, not awaited: it overlaps the permission prompt and getUserMedia
    // below instead of holding the join up on its own round trip. Awaited again
    // just before signaling, which is the first moment a peer connection can be
    // built and therefore the last moment the config still matters.
    const icePromise = loadIceServersRef.current();

    if (mId) {
      void (supabase.from("live_meetings") as any)
        .update({ started_at: new Date().toISOString() })
        .eq("id", mId)
        .is("started_at", null);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        attendeeRef.current = { meetingId: mId, userId: user.id };
        // Awaited, and the error read. This upsert spent its whole life as a
        // fire-and-forget `void` naming a conflict target no unique index
        // matched, so Postgres refused every one of them with 42P10 and nobody
        // heard: no attendance was ever recorded, and reports — readable by
        // "host OR participant" — became host-only in practice.
        const { error } = await supabase
          .from("live_meeting_participants")
          .upsert(attendanceRecord(mId, user.id, name), { onConflict: PARTICIPANT_CONFLICT_TARGET });
        if (error) {
          attendeeRef.current = null;
          // Not fatal to the call: being in the room matters more than being
          // recorded in it. But it must be visible, because the consequence
          // (no report for this member afterwards) shows up much later and
          // nowhere near the cause.
          console.error("[meeting] attendance not recorded", error.message);
        }
      }
    }

    const choice = joinChoiceRef.current;
    const camId = choice?.cameraId ?? "";
    const micId = choice?.micId ?? "";
    // Camera off in the green room means we never open the camera at all, not
    // that we open it and disable the track: the hardware light staying dark is
    // the whole point of the toggle.
    const wantCam = choice ? choice.cameraEnabled : true;

    // Take the green room's devices rather than closing them and opening the
    // same two again. That reopen was the most expensive thing on this path and
    // the least necessary — a few hundred milliseconds, more on Windows, a
    // camera light blinking at the moment somebody is watching their own face,
    // and a race the room could lose, because a camera released a moment ago is
    // often still held when it is asked for again. planPreviewAdoption decides
    // whether what is open is what the call would have opened; anything else
    // falls through to the full path below, which knows how to walk devices and
    // to say why when it cannot.
    const preview = previewStreamRef.current;
    const previewCam = preview?.getVideoTracks()[0] ?? null;
    const previewMic = preview?.getAudioTracks()[0] ?? null;
    const plan = planPreviewAdoption({
      wantCamera: wantCam,
      cameraId: camId,
      micId,
      camera: factsOf(previewCam),
      microphone: factsOf(previewMic),
    });

    let opened: OpenedMedia;
    if (plan.adopt && previewMic) {
      // The camera the call does not want is stopped here and not carried: a
      // member joining with their camera off has a dark light as the point.
      if (!plan.camera && previewCam) { try { previewCam.stop(); } catch { /* already stopped */ } }
      const cameraTrack = plan.camera ? previewCam : null;
      // The green room stops owning these now, in both directions: it will not
      // stop them, and nothing it says afterwards is filed as a preview.
      adoptedPreviewRef.current = true;
      releasePreviewRef.current?.();
      opened = {
        cameraTrack,
        micTrack: previewMic,
        cameraWanted: wantCam,
        // Nothing fell back and nothing failed: these are the devices that were
        // asked for, still open, reported by what is live rather than by what
        // was requested.
        camera: cameraTrack
          ? { deviceId: cameraTrack.getSettings().deviceId || camId || "", fellBack: false, failure: null }
          : { deviceId: null, fellBack: false, failure: null },
        microphone: { deviceId: previewMic.getSettings().deviceId || micId || "", fellBack: false, failure: null },
      };
    } else {
      // Not adoptable — a device was swapped between the green room and the
      // press, or the preview never opened one. Release what there is and open
      // properly.
      //
      // One unavailable device no longer costs the other. This used to be a
      // single combined getUserMedia, and a combined request fails WHOLE: one
      // camera another application already held — Zoom left open, OBS, or
      // simply the green room's own preview a few milliseconds from being
      // released — and the member landed here with an empty MediaStream. No
      // camera, which was the real problem, and no microphone, which was never
      // broken, for the rest of the call.
      //
      // openCallMedia keeps the single permission prompt for the ordinary path
      // and only splits the request when that fails, then walks the member's
      // choice, their remembered device, the system default and the rest of the
      // hardware in that order — retrying a merely-busy device once, because
      // releasing a camera is asynchronous and this may have let go of one a
      // moment ago.
      preview?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
      opened = await openCallMedia({
        wantCamera: wantCam,
        cameraId: camId,
        micId,
        rememberedCameraId: rememberedDevice("videoinput"),
        rememberedMicId: rememberedDevice("audioinput"),
      });
    }
    previewStreamRef.current = null;

    const stream = new MediaStream();
    if (opened.micTrack) stream.addTrack(opened.micTrack);
    if (opened.cameraTrack) stream.addTrack(opened.cameraTrack);

    // What is LIVE, not what was asked for. The in-call pickers read these, and
    // a fallback nobody is told about is how somebody spends a meeting talking
    // into their laptop while the menu insists they are on their headset.
    setSelectedCamId(opened.camera.deviceId ?? "");
    setSelectedMicId(opened.microphone.deviceId ?? "");
    // Null when everything opened as asked, so a clean join says nothing.
    setMediaError(acquisitionMessage(opened));
    // A device the member wanted and did not get is not the end of the matter.
    // The common failure by a distance is a camera still held by the Zoom they
    // have not quit yet, and that condition ends — usually within seconds, and
    // until now with nothing watching for the moment it did.
    setCameraToRecover(wantCam && !opened.cameraTrack ? opened.camera.failure : null);
    setMicToRecover(!opened.micTrack ? opened.microphone.failure : null);
    // Carry the green room's mic/camera state into the call, so someone who
    // muted themselves before joining is still muted a second later.
    const micWanted = choice ? choice.micEnabled : true;
    micIntentRef.current = micWanted;
    camWantedRef.current = wantCam;
    stream.getAudioTracks().forEach((t) => { t.enabled = micWanted; });
    const micLive = micWanted && stream.getAudioTracks().length > 0;
    setMicOn(micLive);
    // Read synchronously by the join announcement below, which runs before the
    // effect that mirrors `micOn` into this ref.
    micOnRef.current = micLive;
    const camLive = wantCam && stream.getVideoTracks().length > 0;
    setCamOn(camLive);
    camOnRef.current = camLive;

    localStreamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
    rawCameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
    setRawCameraTrack(rawCameraTrackRef.current);
    setLocalStream(stream);

    // Carry in the background settled on in the green room, falling back to the
    // remembered one for the paths that skip it (a re-join, a waiting-room
    // admission). Deliberately not awaited: the segmenter is a 12MB download
    // and joining should never wait on scenery.
    let wanted = choice?.background;
    if (!wanted) {
      try { wanted = decodeEffect(window.localStorage.getItem(BACKGROUND_PREF_KEY)); }
      catch { /* storage disabled — start with no effect */ }
    }
    if (wanted && needsSegmentation(wanted)) {
      // Hold the camera off the wire until the effect is live. Building the
      // processor is asynchronous and this function does not wait for it, but
      // the channel below announces us immediately — so peers offer, tracks are
      // added, and the raw camera goes out for however long the build takes. For
      // someone who chose to hide the room they are sitting in, that is the one
      // failure this feature exists to prevent.
      //
      // The hold is the disabled track itself and nothing else: every path out
      // of here goes through swapOutgoingVideo, which sets `enabled` from
      // camOnRef as it puts a track on the wire — the processed track when the
      // effect lands, the raw camera when it is abandoned. (A flag that tracked
      // this separately was only ever written, never read.)
      stream.getVideoTracks().forEach((t) => { t.enabled = false; });
      // Caught rather than left to float: the camera is disabled above and it is
      // this call that re-enables it, so a rejection nobody handles is a member
      // sitting in a meeting whose own controls say their camera is on while
      // every other tile shows nothing.
      void applyBackgroundRef.current(wanted).catch((err) => {
        console.warn("[meeting] background could not be applied", err);
        abandonBackgroundRef.current("Your background couldn't be applied — your camera is off so your room stays private. Turn it on when you're ready.");
      });
    }

    // Peers are only ever created in response to signaling, so the ICE config
    // has to be real before any of it is acted on. That used to be enforced by
    // waiting here — which also made two independent round trips take turns: the
    // config fetch, and then a WebSocket handshake that had nothing to do with
    // it. A guest pays for both at the worst moment, having already waited for a
    // host to let them in.
    //
    // So the socket is opened now and the deadline is moved to the two places it
    // actually falls: nothing is ANNOUNCED until the config has landed (nobody
    // offers to us before we have said hello), and handleSignal waits on the
    // same promise before acting on anything (so a peer who was already in the
    // room and offers first cannot build a connection on the fallback either).
    iceReadyRef.current = icePromise;

    const channel = supabase.channel(`meeting:${roomCode}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel.on("broadcast", { event: "signal" }, ({ payload }: { payload: SignalMsg }) => { void handleSignal(payload); })
      .subscribe((status) => {
        // The callback also fires for CHANNEL_ERROR / TIMED_OUT / CLOSED, and
        // again on reconnect. Only a real subscription is worth acting on.
        if (status !== "SUBSCRIBED") return;
        const first = !announcedRef.current;
        announcedRef.current = true;
        void icePromise.then(() => {
          // Announcing once was the last door closed on a call that lost its
          // network. A `join` is the only message that rebuilds a peer
          // connection from nothing, so after a socket drop — which is also a
          // socket that carried none of the offers our ICE restarts were
          // producing — the peers still trying to recover were restarting into
          // a void, and nothing would ever say hello again.
          //
          // Not on every resubscribe, though: a socket that blipped while the
          // media kept flowing needs nothing, and a `join` tears down every
          // peer connection in the room and rebuilds it. So it is sent only
          // when there is something to rebuild.
          const stalled = [...peersRef.current.values()].some(
            (pc) => pc.connectionState !== "connected" && pc.connectionState !== "closed",
          );
          if (!first && !stalled) return;
          sendSignal({ type: "join", from: myIdRef.current, displayName: name });
          sendSignal({ type: "mic", from: myIdRef.current, micOn: micOnRef.current, displayName: name });
          announceVideoStateRef.current();
        });
      });

    clearWaitingTimers();
    setWaitingForAdmit(false);
    setWaitingTimedOut(false);
    setAdmissionFailed(false);
    setReady(true);
    setJoining(false);

    // The real request is made synchronously from the Join click, where the user
    // activation still stands. This is the fallback for the one case that misses
    // it: a host whose own identity was not known at click time — `detectHost`
    // still in flight, or a meeting this very call just created. The prompt may
    // be suppressed for want of activation, which costs nothing, because the
    // alternative is a host who is never offered it at all.
    requestHostNotifications(isHostRef.current);
  }, [supabase, roomCode, handleSignal, sendSignal, clearWaitingTimers]);

  /**
   * Fetch the ICE servers for this call.
   *
   * Carries the guest's room code and admission key, because an invite-link
   * guest has no session and the endpoint authorizes them by the admission the
   * host already granted. Without them a guest got a 401, the failure was
   * swallowed, and the call fell back to STUN with no relay — which is how
   * cameras and microphones opened correctly and then connected to nobody.
   *
   * A failure here is not cosmetic: on a network that needs a relay it is the
   * difference between a working call and a black square. So it retries once,
   * and says so in the console either way rather than failing silently.
   *
   * Every attempt is bounded, which matters more than it used to. A `fetch`
   * that is never answered is never rejected either — a captive portal or a
   * proxy that black-holes the request leaves it pending for as long as the tab
   * is open — and this promise is what the signalling path waits on. Unbounded,
   * one silent request would mean a member who is nominally in the meeting and
   * never hears a word of it. A deadline turns that into the failure it should
   * always have been: STUN only, said out loud, and a call that at least
   * connects for everyone who does not need a relay.
   */
  const loadIceServers = useCallback(async () => {
    const query = new URLSearchParams({ roomCode });
    const key = guestKeyRef.current;
    if (key) query.set("guestKey", key);

    for (let attempt = 0; attempt < 2; attempt++) {
      // Long enough for a slow mobile connection to answer a request to our own
      // origin, short enough that nobody sits through it twice and wonders.
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), ICE_FETCH_TIMEOUT_MS);
      try {
        const r = await fetch(`/api/meetings/ice-servers?${query}`, { cache: "no-store", signal: abort.signal });
        if (r.ok) {
          const { iceServers, relay, reason } = await r.json() as {
            iceServers?: RTCIceServer[]; relay?: boolean; reason?: string;
          };
          if (Array.isArray(iceServers) && iceServers.length > 0) {
            relayAvailableRef.current = relay === true;
            // Guests go straight to the relay. They are the population always on
            // somebody else's network, and the direct path they would try first
            // is the one that fails — so skipping it turns a call that formed
            // after a failure, a restart and a stall into one that forms on the
            // first attempt. Guarded on actually having a relay: forcing it
            // without one leaves a connection no candidates at all, which would
            // break the guests who were working.
            const relayOnly = shouldForceRelay({
              isGuest: isGuestRef.current,
              relayAvailable: relay === true,
            });
            iceConfigRef.current = peerConfig(iceServers, { relayOnly });
            if (relayOnly) {
              console.info("[meeting] guest media will be relayed — direct paths are not attempted");
            }
            if (relay !== true) {
              // Worth a line even though the call may still work: it explains
              // any later connection failure on a restrictive network. The
              // reason is what makes it actionable — "TURN was never configured
              // here" and "the provider is refusing our key" look identical
              // from a blank tile, and have completely different owners.
              console.warn(
                reason === "misconfigured"
                  ? "[meeting] TURN is configured but unusable — check TURN_URLS lists a turn: URL and TURN_SECRET matches the TURN server. Guests behind symmetric NAT or CGNAT will fail to connect."
                  : "[meeting] no TURN relay configured for this deployment — guests behind symmetric NAT, a corporate firewall or mobile CGNAT will fail to connect",
              );
            }
            return;
          }
        }
        // 401 here means the guest is not admitted (or the key was lost); any
        // other status is the endpoint failing. Neither is retried more than
        // once, and neither is silent.
        if (r.status === 401 || r.status === 429) {
          console.warn(`[meeting] ice-servers refused (${r.status}) — falling back to STUN only`);
          return;
        }
      } catch (err) {
        if (attempt === 1) console.warn("[meeting] ice-servers unreachable — falling back to STUN only", err);
      } finally {
        clearTimeout(deadline);
      }
    }
  }, [roomCode]);

  const loadIceServersRef = useRef(loadIceServers);
  useEffect(() => { loadIceServersRef.current = loadIceServers; }, [loadIceServers]);

  // Stable handle so the waiting-room poll can enter without re-creating itself.
  const enterRoomRef = useRef(enterRoom);
  useEffect(() => { enterRoomRef.current = enterRoom; }, [enterRoom]);

  // What we ask for follows what we draw — and, since the link state is built
  // entirely from inbound measurements, what we can afford to receive.
  useEffect(() => {
    if (!ready) return;
    refreshVideoRequestsRef.current();
  }, [ready, stageLayout, stageFocus, peers, peerVideo, bwMode]);

  // A backgrounded tab draws nothing, so it should receive nothing. This is the
  // only lever that removes encoder cost at the far end rather than reducing
  // it — five people with the call in a background tab stop five encoders each
  // on everyone else's machine.
  useEffect(() => {
    if (!ready) return;
    const onVisibility = () => refreshVideoRequestsRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ready]);

  // ── joinMeeting ──────────────────────────────────────────────────────────
  const joinMeeting = useCallback(async (choice?: GreenRoomChoice) => {
    // A join that did not complete — a cancelled knock, a deny, a second
    // press — leaves the green room still holding its own devices, so the next
    // attempt is free to adopt them again.
    adoptedPreviewRef.current = false;
    setAdmissionFailed(false);
    if (choice) {
      joinChoiceRef.current = choice;
      setSelectedCamId(choice.cameraId);
      setSelectedMicId(choice.micId);
      setSelectedSpeakerId(choice.speakerId);
    }
    // Before the first await, while the click that got us here is still a live
    // user activation. `detectHost` has usually resolved by now — the green room
    // stands between page load and this press — so the host is already known.
    requestHostNotifications(isHostRef.current);

    setJoining(true);
    const name = displayName.trim() || "Participant";
    setLocalName(name);
    localNameRef.current = name;

    // Resolve the meeting + whether we're the host.
    let mId: string | null = null;
    let hostFlag = false;
    // A signed-in member of the meeting's org can read the row under RLS (guests
    // and other orgs cannot), so a successful RLS read == "teammate". Teammates
    // skip the waiting room and enter directly, just like the host.
    let isOrgMember = false;
    // Resolved once and carried: this used to be asked for twice, and the
    // second answer was always the first one.
    let me: { id: string } | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      me = user ? { id: user.id } : null;
      // Only a signed-in caller can learn anything here. A guest's read either
      // returns nothing (an org-scoped meeting) or returns exactly what the
      // public endpoint below returns anyway (an org-less one) — so for them it
      // was a round trip that changed no outcome, spent between being admitted
      // and being in the room.
      const { data: existing } = user
        ? await supabase
          .from("live_meetings")
          .select("id, status, host_id, title, organization_id")
          .eq("room_code", roomCode)
          .maybeSingle()
        : { data: null };
      const ex = existing as { id: string; status: string; host_id: string; title: string | null; organization_id: string | null } | null;
      if (ex) {
        mId = ex.id;
        if (ex.title) setMeetingTitle(ex.title);
        if (ex.status === "ended") { router.push(`/meetings/${roomCode}/report`); return; }
        hostFlag = !!user && user.id === ex.host_id;
        // This read went through RLS, and `live_meetings_select` passes a row on
        // EITHER org membership OR `organization_id IS NULL`. So a returned row
        // only proves membership when the meeting actually has an org — reading
        // it as `!!user` let any signed-in stranger walk into an org-less meeting
        // without knocking at all. When it proves nothing, knock and let the
        // server decide; it checks real membership and auto-admits teammates.
        isOrgMember = !!user && !!ex.organization_id;
      } else {
        const pub = await fetch(`/api/meetings/public/${roomCode}`, { cache: "no-store" });
        if (pub.ok) {
          const d = await pub.json() as { id: string; title: string | null; status: string };
          mId = d.id;
          if (d.title) setMeetingTitle(d.title);
          if (d.status === "ended") { leaveEndedMeeting(); return; }
        } else if (user) {
          const res = await fetch("/api/meetings/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Meeting", roomCode }) });
          if (res.ok) {
            const d = await res.json() as { id: string; roomCode: string; hostId: string };
            mId = d.id;
            hostFlag = user.id === d.hostId;
          }
        }
      }
    } catch { /* proceed */ }

    setMeetingId(mId); meetingIdRef.current = mId;
    setIsHost(hostFlag); isHostRef.current = hostFlag;
    localUserIdRef.current = me?.id ?? null;

    // The conversation so far. Somebody joining ten minutes into a call used
    // to see an empty panel while the room referred back to what had been said
    // in it — and a reload did the same thing to a person who had been there
    // the whole time. Merged rather than assigned, because a broadcast can
    // arrive before this resolves.
    void loadChatHistoryRef.current();

    // The host and org teammates enter immediately; only external guests wait.
    if (hostFlag || isOrgMember) {
      await enterRoom(mId, name);
      return;
    }

    // Non-host: knock (DB-backed) and wait. Camera/mic + signaling stay untouched
    // until we're admitted, so an un-admitted guest never appears in the room.
    //
    // The sequence itself — knock, read the verdict, poll for one that has not
    // come, re-knock when the server has no record of us, and stop the moment it
    // does — lives in createAdmissionSession, where it can be driven by a test
    // rather than by a WebRTC stack. This function only says what each outcome
    // means for the screen.
    const guestKey = guestKeyRef.current as string;

    // A second join without an intervening teardown would otherwise leave the
    // first session running and its visibility listener attached, both invisible.
    clearWaitingTimers();
    // Asking again starts clean: the previous attempt's refusal and its
    // abandoned wait are both statements about a wait that is now over.
    setAdmissionBusy(false);
    setWaitingGaveUp(false);

    const session = createAdmissionSession({
      // Both halves read the response the same way now. The knock used to do
      // `if (!res.ok) return null` inline, which made a knock the rate limiter
      // REFUSED — no row inserted, host never told — indistinguishable from one
      // that simply had no answer yet, and put the guest on "waiting for the
      // host to let you in" over a queue they were not in.
      knock: async () => {
        const res = await fetch(`/api/meetings/public/${roomCode}/knock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The id this client will appear under in the room, so the host's
          // "remove that tile" can be resolved by the server rather than
          // claimed by a peer. See the removals route.
          body: JSON.stringify({ guestKey, displayName: name, signalId: myIdRef.current }),
        });
        const body = res.ok ? ((await res.json()) as { status?: string }) : null;
        const status = admissionStatusFromResponse(res.status, body);
        return {
          // A 2xx with no status is still a recorded knock; keep the old reading.
          status: res.ok && status === null ? "waiting" : status,
          retryAfterMs: retryAfterMs(res.headers.get("Retry-After")),
        };
      },
      poll: async () => {
        const res = await fetch(`/api/meetings/public/${roomCode}/knock?key=${encodeURIComponent(guestKey)}`, { cache: "no-store" });
        // A 404 is the one non-OK answer that IS an answer: the meeting is not
        // there. Collapsing it into "no news" left a guest whose host cancelled
        // watching a spinner for as long as the tab stayed open.
        const body = res.ok ? ((await res.json()) as { status?: string }) : null;
        return {
          status: admissionStatusFromResponse(res.status, body),
          retryAfterMs: retryAfterMs(res.headers.get("Retry-After")),
        };
      },
      // Realtime carries a nudge, never a verdict — see admission-channel.ts.
      // The session answers it by asking the server, so a forged broadcast buys
      // nothing but one wasted request. Guests cannot watch the admissions table
      // itself (unauthenticated, and it is org-read only), but they can hold a
      // broadcast channel with the anon key — the same way they already hold the
      // signalling channel once they are in.
      watch: ({ onNudge, onConnectionChange }) => {
        const channel = supabase
          .channel(admissionChannelName(roomCode, guestKey))
          .on("broadcast", { event: ADMISSION_NUDGE }, () => onNudge())
          .subscribe((status: string) => {
            // Anything but SUBSCRIBED means a push would not reach us, so the
            // session goes back to asking on the responsive cadence.
            onConnectionChange(status === "SUBSCRIBED");
          });
        return () => { void supabase.removeChannel(channel); };
      },
      onAdmitted: async () => { await enterRoomRef.current(mId, name); },
      // Entering the room opens devices and builds connections, and by the time
      // it runs the session has already torn itself down. Without this the
      // failure vanished and the guest sat on the waiting screen for good.
      onAdmitFailed: (err) => {
        console.error("[meeting] admitted, but could not enter the room", err);
        setWaitingForAdmit(false);
        setWaitingTimedOut(false);
        setJoining(false);
        setAdmissionFailed(true);
      },
      onDenied: showDenied,
      onEnded: leaveEndedMeeting,
      // Only reached when the host has not already decided — so this is where
      // the waiting screen goes up, and the local preview with it.
      onWaiting: () => { setWaitingForAdmit(true); setJoining(false); },
      onTimedOut: () => setWaitingTimedOut(true),
      // The screen stops claiming a queue while the server is refusing us, and
      // goes back to the ordinary waiting copy the moment one gets through.
      onBusy: setAdmissionBusy,
      // The wait ended itself. Nothing is asking any more, so the row is ours
      // to clean up — the host should not be left holding a name that stopped
      // waiting ten minutes ago.
      onGaveUp: () => {
        withdrawKnock();
        setWaitingGaveUp(true);
        setWaitingForAdmit(false);
        setWaitingTimedOut(false);
        setJoining(false);
      },
    });
    admissionSessionRef.current = session;
    await session.start();
  }, [displayName, roomCode, supabase, router, enterRoom, clearWaitingTimers, showDenied, leaveEndedMeeting, withdrawKnock]);

  // ── Host: waiting-room admissions (DB-backed) ─────────────────────────────
  // Load the pending knocks for this meeting and keep them live. Reads go under
  // the org-read RLS policy; a per-meeting Realtime subscription refreshes the
  // list the instant a guest knocks or a decision is written.
  const loadWaiting = useCallback(async () => {
    if (!meetingId) return;
    const { data } = await (supabase as any)
      .from("live_meeting_admissions")
      .select("id, guest_key, display_name, status, last_seen_at, created_at")
      .eq("meeting_id", meetingId)
      .eq("status", "waiting")
      // Stale rows are excluded HERE, not after the cap. Filtering them in the
      // client would mean the oldest WAITING_CAP rows are fetched first and
      // then thinned — so a queue whose head is full of people who left would
      // push every guest who is actually waiting outside the result, and the
      // host would see nobody at all.
      //
      // `last_seen_at` is null until a guest's first poll lands, so a row that
      // has never been seen counts as present, exactly as `stillWaiting` does.
      .or(`last_seen_at.is.null,last_seen_at.gte.${new Date(Date.now() - PRESENCE_GRACE_MS).toISOString()}`)
      .order("created_at", { ascending: true })
      // Bounded, like every other read in the meeting stack. An unbounded
      // select is cut off at PostgREST's `max_rows` with nothing to say so —
      // the same silent truncation the transcript read carried for months —
      // and a knock costs an attacker one request. A host cannot work a queue
      // this long anyway; what matters is that the panel is not lying about
      // where it stops.
      .limit(WAITING_CAP);
    const rows = (data ?? []) as WaitingRow[];
    // Anything the host has just decided on is held back, however the table
    // still describes it. This read is scheduled off ANY admission event — a
    // second guest's presence write will do — so it routinely lands inside the
    // window where an admit is still in flight.
    const now = Date.now();
    decidedRef.current = pruneDecided(decidedRef.current, now);
    setWaitingPeers(withoutDecided(rows.map(toEntry), decidedRef.current, now));
  }, [meetingId, supabase]);

  /** Everyone the host has removed, for the panel that can let them back in. */
  const loadRemovals = useCallback(async () => {
    if (!meetingId) return;
    const { data } = await (supabase as any)
      .from("live_meeting_removals")
      .select("user_id, guest_key, display_name")
      .eq("meeting_id", meetingId)
      .order("removed_at", { ascending: true })
      .limit(WAITING_CAP);
    const rows = (data ?? []) as Array<{ user_id: string | null; guest_key: string | null; display_name: string }>;
    setRemovedPeople(
      rows
        .map((r) => {
          const subject = subjectFor(r.user_id, r.guest_key);
          return subject ? { subject, displayName: r.display_name } : null;
        })
        .filter((r): r is RemovedPerson => r !== null),
    );
  }, [meetingId, supabase]);

  const loadRemovalsRef = useRef(loadRemovals);
  useEffect(() => { loadRemovalsRef.current = loadRemovals; }, [loadRemovals]);

  /**
   * Let a removed person back in.
   *
   * Only lifts the bar at the door — they still have to knock, and the host
   * still decides, which is the point: the host sees who it is before they are
   * back in the room.
   */
  const allowBack = useCallback(async (subject: RemovalSubject) => {
    if (!meetingIdRef.current) return;
    const key = subjectKey(subject);
    setRemovedPeople((prev) => prev.filter((r) => subjectKey(r.subject) !== key));
    try {
      const res = await fetch(`/api/meetings/${meetingIdRef.current}/removals`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject }),
      });
      if (res.ok) return;
      console.warn("[meeting] could not let them back in", res.status);
    } catch (err) {
      console.warn("[meeting] could not let them back in", err);
    }
    // The optimism needs an undo, for the same reason admit/deny's does: the
    // list is not driven by Realtime, so nothing else would put them back and
    // the host would believe they had lifted a bar that is still down.
    await loadRemovalsRef.current();
  }, []);

  useEffect(() => {
    if (!isHost || !sessionLive || !meetingId) return;
    void loadWaiting();
    void loadRemovals();

    // Each event is applied to the list immediately — it carries the row, so the
    // panel redraws without waiting on a query — and schedules one reconciling
    // re-read for the whole burst. A room filling up, or an "Admit all" over
    // eight people, is now one SELECT instead of eight.
    let reconcile: ReturnType<typeof setTimeout> | null = null;
    const scheduleReconcile = () => {
      if (reconcile !== null) return;
      reconcile = setTimeout(() => { reconcile = null; void loadWaiting(); }, RECONCILE_MS);
    };

    const channel = supabase
      .channel(`admissions:${meetingId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_meeting_admissions", filter: `meeting_id=eq.${meetingId}` },
        (payload: unknown) => {
          // Same guard on the event path: a presence write on a just-admitted
          // row arrives as an UPDATE whose status is still `waiting`, which
          // would put the person the host removed straight back.
          setWaitingPeers((prev) =>
            withoutDecided(
              applyAdmissionChange(prev, payload as AdmissionChange),
              decidedRef.current,
              Date.now(),
            ),
          );
          scheduleReconcile();
        },
      )
      // Anything but SUBSCRIBED means knocks are not reaching this panel. The
      // callback also fires for CHANNEL_ERROR, TIMED_OUT and CLOSED, and again
      // on reconnect, so this tracks the current state rather than latching.
      .subscribe((status: string) => setWaitingLive(status === "SUBSCRIBED"));
    return () => {
      if (reconcile !== null) clearTimeout(reconcile);
      setWaitingLive(false);
      void supabase.removeChannel(channel);
    };
  }, [isHost, sessionLive, meetingId, supabase, loadWaiting, loadRemovals]);

  /**
   * The floor under the host's panel.
   *
   * Only runs while the subscription is not carrying events, which on a healthy
   * call is never — so the ordinary meeting pays nothing for it. When the socket
   * is gone it is the difference between a host who can admit their guests and
   * one who never learns they are there.
   */
  useEffect(() => {
    if (!isHost || !sessionLive || !meetingId || waitingLive) return;
    const timer = setInterval(() => { void loadWaiting(); }, WAITING_FALLBACK_MS);
    return () => clearInterval(timer);
  }, [isHost, sessionLive, meetingId, waitingLive, loadWaiting]);

  /**
   * The people at the door who are actually still there.
   *
   * A `waiting` row is cleared by a decision and by nothing else, so a guest
   * who knocked and then closed the tab used to stay in this panel for the rest
   * of the meeting — chiming, badging the tab title, counting in "Waiting to
   * join (3)", and ending with the host admitting somebody who was never going
   * to appear. Their poll is the sign of life, and it is now recorded.
   *
   * Filtered here rather than by deleting the row: a guest who comes back —
   * reopened the tab, came out of a tunnel — starts polling again and reappears
   * with their place in the queue, instead of having to knock afresh and lose
   * it. Presence goes stale on the clock rather than on an event, so this
   * carries its own tick.
   */
  const [presenceNowMs, setPresenceNowMs] = useState(() => Date.now());
  // Only while somebody is waiting: with an empty queue there is nothing to
  // expire, and the tick was re-rendering the whole room for the entire call.
  const anyoneWaiting = waitingPeers.length > 0;
  useEffect(() => {
    if (!isHost || !sessionLive || !anyoneWaiting) return;
    setPresenceNowMs(Date.now());
    const timer = setInterval(() => setPresenceNowMs(Date.now()), PRESENCE_TICK_MS);
    return () => clearInterval(timer);
  }, [isHost, sessionLive, anyoneWaiting]);

  // The current time, not the last tick's: the tick is paused while nobody is
  // waiting, and filtering a newly arrived list against a clock frozen minutes
  // ago would briefly count a stale knock as present — and chime for it.
  const livePeers = useMemo(
    () => presentOnly(waitingPeers, Math.max(presenceNowMs, Date.now())),
    [waitingPeers, presenceNowMs],
  );

  // A knock makes a sound. The bar below the video is visible whatever tab the
  // sidebar is on, but a host who has switched to another window sees none of
  // it — and a guest at the door is the one thing in a meeting that is waiting
  // on the host personally. Only a rise counts, so admitting four people does
  // not chime on the way back down.
  const lastWaitingCountRef = useRef(0);
  useEffect(() => {
    const count = livePeers.length;
    const previous = lastWaitingCountRef.current;
    lastWaitingCountRef.current = count;
    if (isHost && count > previous) playChime("knock");

    // And a system notification, which is the only one of the three that
    // reaches a host who has switched to another application entirely — the
    // host most likely to leave someone standing outside. knockAlert decides:
    // host only, only on a rise, only while this tab is hidden, only once
    // permission has actually been granted.
    const alert = knockAlert({
      isHost,
      waiting: count,
      previousWaiting: previous,
      hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
      permission: notificationPermission(),
      name: livePeers.length === 1 ? livePeers[0]?.displayName : null,
    });
    if (!alert) return;

    try {
      const note = new Notification(alert.title, {
        body: alert.body,
        // One knock notification at a time. A second guest replaces the first
        // rather than stacking, so a host who was away for a while comes back
        // to one current notice instead of a column of stale ones.
        tag: "fundexecs-knock",
      });
      note.onclick = () => { try { window.focus(); } catch { /* popup blocked */ } note.close(); };
    } catch { /* the constructor throws on some engines even when permitted */ }
  }, [isHost, livePeers]);

  // Carry the waiting count into the browser tab title. A host who has tabbed
  // away to pull up a document is exactly the host most likely to leave someone
  // standing outside, and the in-page bar cannot reach them there.
  useEffect(() => {
    if (!isHost) return;
    const original = document.title;
    if (livePeers.length > 0) document.title = `(${livePeers.length}) Waiting to join · ${original}`;
    return () => { document.title = original; };
  }, [isHost, livePeers.length]);

  /**
   * Route call audio to the chosen output device.
   *
   * `setSinkId` is per-element, so this has to be re-run over the current
   * elements rather than set once. Not every browser has it (Firefox), which is
   * why the capability is checked per element rather than assumed.
   *
   * `needsSinkChange` owns which elements that is, and why. It narrowed this
   * from "every video and audio element in the document" to the call's own
   * unmuted media, and fixed an "already there" check that never fired for the
   * system default — so a roster change used to rebuild the audio pipeline of
   * every element on the page, including the muted local tile, every time.
   *
   * In parallel, not in turn. Each call is a pipeline rebuild, and on a
   * twelve-person call awaiting them one after another serialised twelve of
   * them behind each other on a path that runs whenever anybody joins.
   * `allSettled`, because one device disappearing must not abandon the rest.
   */
  const applySpeakerSink = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    type Sinkable = HTMLMediaElement & { sinkId?: string; setSinkId?: (id: string) => Promise<void> };
    const elements = Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio")) as Sinkable[];
    await Promise.allSettled(
      elements
        .filter((el) => needsSinkChange(el, deviceId))
        .map((el) => el.setSinkId!(deviceId)),
    );
  }, []);

  // Apply the chosen speaker — on join, and again whenever the set of people in
  // the room changes. A sink is set on an element, and a peer who joins later
  // arrives with a brand new one: without re-running here, the member who
  // deliberately chose their headset heard everybody after the first through
  // the laptop speakers instead, with nothing on screen to explain it.
  useEffect(() => {
    if (!ready || !selectedSpeakerId) return;
    void applySpeakerSink(selectedSpeakerId);
    // callParts: the tiles that carry the audio mount when it arrives.
    // sameRoomPeers: an element that was muted skipped routing, and needs it
    // the moment it plays again.
  }, [ready, selectedSpeakerId, peers, applySpeakerSink, callParts, sameRoomPeers]);

  // ── How long the meeting has been live ────────────────────────────────────

  // Open a live span while the session is live and bank it when it is not, so a
  // call that drops and recovers counts the stretches it was actually running
  // and not the gap between them. No interval: the total is arithmetic on these
  // two timestamps, asked whenever somebody wants it.
  useEffect(() => {
    if (!sessionLive) return;
    elapsedRef.current = startSpan(elapsedRef.current, monotonicNow());
    return () => {
      elapsedRef.current = stopSpan(elapsedRef.current, monotonicNow());
    };
  }, [sessionLive]);

  // ── Speech recognition ────────────────────────────────────────────────────

  // The recognizer hears the room, not its owner: everyone else arrives through
  // the laptop speakers, and it keeps listening while the user believes they are
  // muted (mute disables the outgoing WebRTC track, not the browser's own tap on
  // the device). So a finalized sentence is not published until the voice
  // activity recorded over the seconds it was spoken says it was really ours.
  useEffect(() => {
    if (!sessionLive) return;
    const w = window as any;
    const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => any) | undefined;
    if (!SR) { setSrStatus("unsupported"); return; }
    const recognition = new SR();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onstart = () => setSrStatus("active");
    // Some engines fire speechstart; where they don't, the first interim result
    // opens the window instead.
    recognition.onspeechstart = () => { utteranceStartRef.current = Date.now(); };

    recognition.onresult = (ev: any) => {
      let interim = ""; let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      const now = Date.now();
      if (utteranceStartRef.current === null && (interim || finalText)) utteranceStartRef.current = now;

      const settled = finalText.trim();
      let attribution: ReturnType<typeof attributeUtterance> | null = null;
      if (settled) {
        const roster: ParticipantAudio[] = [
          { id: LOCAL_SPEAKER_ID, displayName: localNameRef.current, micOn: micOnRef.current, isLocal: true },
          ...[...peersDataRef.current.values()].map((p) => ({
            id: p.id,
            displayName: p.displayName,
            micOn: peerMicOnRef.current.get(p.id) ?? true,
            isLocal: false,
          })),
        ];
        attribution = attributeUtterance(
          { startedAt: utteranceStartRef.current ?? now - 1500, endedAt: now },
          voiceLogRef.current,
          roster,
          { localMicOn: micOnRef.current },
        );
        utteranceStartRef.current = null;
      }

      // Words we decided were somebody else's are dropped, not relabelled: the
      // peer who actually said them is transcribing them on their own device
      // under their own name, and publishing our copy as well would put the same
      // sentence in the transcript twice.
      if (attribution && !attribution.publish) {
        transcriptRef.current = transcriptRef.current.filter((l) => l.final);
        return;
      }

      {
        const next = transcriptRef.current.filter((l) => l.final);
        if (settled && attribution) {
          const ts = now;
          next.push({
            id: crypto.randomUUID(),
            speakerId: LOCAL_SPEAKER_ID,
            speaker: localNameRef.current,
            userId: localUserIdRef.current,
            text: settled,
            ts,
            final: true,
            isLocal: true,
            confidence: attribution.confidence,
            overlapped: attribution.overlapped,
          });
          interimIdRef.current = crypto.randomUUID();
          sendSignalRef.current({
            type: "transcript",
            from: myIdRef.current,
            speaker: localNameRef.current,
            userId: localUserIdRef.current,
            text: settled,
            ts,
            confidence: attribution.confidence,
            overlapped: attribution.overlapped,
          });
        }
        // An interim line under a muted mic would show the user their own name
        // against words the room said — the exact confusion this is here to fix.
        if (interim && micOnRef.current) {
          next.push({
            id: interimIdRef.current,
            speakerId: LOCAL_SPEAKER_ID,
            speaker: localNameRef.current,
            userId: localUserIdRef.current,
            text: interim,
            ts: now,
            final: false,
            isLocal: true,
            confidence: 1,
            overlapped: false,
          });
        }
        transcriptRef.current = next;
      }
    };

    recognition.onerror = (ev: any) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") setSrStatus("error");
      else if (ev.error !== "no-speech") console.warn("[SR]", ev.error);
    };
    // Listen to the call's own microphone track, not the device.
    //
    // A bare `start()` makes the browser open a SECOND capture of the default
    // microphone for the recognizer, with none of the processing the call's
    // track has — no echo cancellation. Two captures of one device with
    // different processing is exactly where browsers stop cancelling echo for
    // the call (they share one input and the unprocessed open wins on several
    // platforms), so whatever the speakers played went straight back out to
    // everybody: host and guests alike heard themselves a beat late for as long
    // as transcription was running, which is the whole call.
    //
    // Engines that accept a track (`start(track)`) get the echo-cancelled one,
    // and only hear what this member says. Engines that do not ignore the
    // argument, and one that rejects it outright gets the old call.
    const startRecognition = () => {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track && track.readyState === "live") {
        try { recognition.start(track); return; } catch (err) {
          // Already running is not a reason to retry without the track.
          if ((err as { name?: string })?.name === "InvalidStateError") return;
        }
      }
      try { recognition.start(); } catch { /* already started */ }
    };
    recognition.onend = () => {
      utteranceStartRef.current = null;
      setSrStatus((prev) => {
        if (prev === "error" || prev === "unsupported") return prev;
        startRecognition();
        return "active";
      });
    };
    startRecognition();
    recognitionRef.current = recognition;
    return () => { recognition.onend = null; recognition.stop(); };
  }, [sessionLive]);


  // ── Voice activity ────────────────────────────────────────────────────────

  // Meters every audio stream in the call — local and remote — and keeps a short
  // history of who was audible when. Three things read it: the speaker-view tile
  // switch, the "who is talking" indicators, and transcript attribution.
  //
  // This runs in every layout, unlike the old speaker-view-only meter. It has to:
  // attribution needs to know whose voice was in the room during an utterance
  // regardless of which tiles the user happens to be looking at.
  // One AudioContext for the whole live call, with a tap per participant added
  // and removed as people come and go. It used to be rebuilt from scratch on
  // every change to `peers` or the local stream — each join changes `peers`
  // about three times — which re-created the context and every analyser and
  // reset every level to zero each time.
  const meterRef = useRef<{ ctx: AudioContext; taps: Map<string, VoiceTap> } | null>(null);

  useEffect(() => {
    if (!sessionLive) return;

    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try { ctx = new Ctor(); } catch { return; }
    // A context created outside a gesture, or one the browser suspended while the
    // tab was in the background, reads every level as zero — which would look
    // like a room where nobody is talking. Nudge it back.
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});

    const taps = new Map<string, VoiceTap>();
    meterRef.current = { ctx, taps };

    // Who the stage is on, and who has been loudest since when while it is not.
    let shownSpeaker: string | null = null;
    let challenger: { id: string; since: number; lastSeen: number } | null = null;

    const interval = setInterval(() => {
      if (taps.size === 0) return;
      const now = Date.now();
      let loudest = 0;
      let loudestId: string | null = null;
      let localLevel = 0;
      let remoteLevel = 0;
      // Unsmoothed levels for the voice-return check: smoothing is a slow fall
      // by design, and that blurs exactly the syllable shape it matches on.
      let localRaw = 0;
      const remoteRaw = new Map<string, number>();

      for (const tap of taps.values()) {
        tap.analyser.getFloatTimeDomainData(tap.buffer);
        const raw = levelFromSamples(tap.buffer);
        tap.smoothed = smoothLevel(tap.smoothed, raw);
        if (tap.id === LOCAL_SPEAKER_ID) localRaw = micOnRef.current ? raw : 0;
        else remoteRaw.set(tap.id, raw);

        // A muted mic is silent anyway, but recording its level as zero keeps a
        // stray sample from a half-applied mute out of the attribution history.
        const micLive = tap.id === LOCAL_SPEAKER_ID ? micOnRef.current : (peerMicOnRef.current.get(tap.id) ?? true);
        const level = micLive ? tap.smoothed : 0;

        voiceLogRef.current.record(tap.id, level, now);
        if (level >= SPEAKING_LEVEL) lastAudibleRef.current.set(tap.id, now);
        if (level > loudest) { loudest = level; loudestId = tap.id; }

        // Echo detection rides along on the levels this loop already has. The
        // local tap's RAW smoothed level, not `level`: `level` is forced to
        // zero for a muted mic, and `observeEcho` wants to know the mic is
        // muted rather than that it is silent -- those are the same number and
        // different facts.
        if (tap.id === LOCAL_SPEAKER_ID) localLevel = tap.smoothed;
        else if (level > remoteLevel) remoteLevel = level;
      }

      // One sample per tick, from signals already computed: no second
      // AudioContext, no second analyser, no extra pass over the audio.
      const verdict = observeEcho(echoWatchRef.current, {
        now,
        localLevel,
        remoteLevel,
        micLive: micOnRef.current,
      });
      // Only on the edge. The verdict is true for as long as the echo lasts,
      // and setting state on every one of the eight samples a second would
      // re-render the room for a string that has not changed.
      if (verdict.started) setEchoNotice(ECHO_DETECTED_NOTICE);

      // A peer carrying this member's own voice back — two devices in one room.
      // Their playback is muted here, automatically; it comes back by itself
      // when the evidence goes, and never again for someone un-muted by hand.
      const returned = observeVoiceReturn(returnWatchRef.current, { local: localRaw, remotes: remoteRaw });
      const add = returned.started.filter((id) => !keepAudibleRef.current.has(id));
      if (add.length || returned.cleared.length) {
        setSameRoomPeers((prev) => {
          const next = new Set(prev);
          add.forEach((id) => next.add(id));
          returned.cleared.forEach((id) => next.delete(id));
          return next;
        });
      }

      if (loudestId && loudest >= SPEAKING_LEVEL) {
        if (loudestId === shownSpeaker) {
          challenger = null;
        } else if (shownSpeaker === null || !taps.has(shownSpeaker)) {
          // Nobody on stage yet, or they have left: no one to hold it for.
          shownSpeaker = loudestId;
          challenger = null;
          setActiveSpeakerId(loudestId);
        } else if (challenger?.id !== loudestId || now - challenger.lastSeen > SPEAKER_GAP_MS) {
          // A new challenger — or the same one after a silence, so one cough
          // followed ten seconds later by another cannot add up to a second
          // of talking.
          challenger = { id: loudestId, since: now, lastSeen: now };
        } else if (now - challenger.since < SPEAKER_SWITCH_MS) {
          challenger.lastSeen = now;
        } else {
          shownSpeaker = loudestId;
          challenger = null;
          setActiveSpeakerId(loudestId);
        }
      }

      // No equality check needed here any more: publish compares membership per
      // id and wakes only the leaves whose answer moved.
      speakingStore.publish(speakingIds(lastAudibleRef.current, now));
    }, VOICE_SAMPLE_MS);

    return () => {
      clearInterval(interval);
      taps.forEach((t) => { try { t.source.disconnect(); } catch { /* context already gone */ } });
      taps.clear();
      meterRef.current = null;
      void ctx.close().catch(() => {});
    };
    // `speakingStore` is a ref value, so its identity never changes and this
    // effect still runs once per live session. Listed rather than silenced: the
    // dependency is honest, and a future refactor that made the store per-render
    // should restart this loop rather than publish into an abandoned one.
  }, [sessionLive, speakingStore]);

  // Keep the taps in step with who is in the call. Declared after the effect
  // above so, in the commit that makes the call live, the context exists by the
  // time this runs.
  useEffect(() => {
    const meter = meterRef.current;
    if (!sessionLive || !meter) return;

    const wanted = new Map<string, MediaStreamTrack>();
    const add = (id: string, stream: MediaStream | null | undefined) => {
      const track = stream?.getAudioTracks()[0];
      if (track) wanted.set(id, track);
    };
    add(LOCAL_SPEAKER_ID, localStream);
    for (const p of peers.values()) add(p.id, p.stream);

    // Drop taps for people who left, or whose audio track was replaced.
    for (const [id, tap] of meter.taps) {
      if (wanted.get(id) === tap.track) continue;
      try { tap.source.disconnect(); } catch { /* already gone */ }
      meter.taps.delete(id);
    }

    for (const [id, track] of wanted) {
      if (meter.taps.has(id)) continue;
      try {
        // Tap a stream holding only the audio track — feeding a source node a
        // stream whose video track is later replaced (screen share) can drop the
        // tap on some browsers.
        const source = meter.ctx.createMediaStreamSource(new MediaStream([track]));
        const analyser = meter.ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        meter.taps.set(id, { id, track, analyser, source, buffer: new Float32Array(analyser.fftSize), smoothed: 0 });
      } catch { /* a stream can end between render and tap */ }
    }
  }, [sessionLive, localStream, peers]);

  // Someone who leaves stops being "speaking" — otherwise their dot stays lit on
  // the last frame they were audible in.
  useEffect(() => {
    const live = new Set<string>([LOCAL_SPEAKER_ID, ...peers.keys()]);
    for (const id of lastAudibleRef.current.keys()) {
      if (!live.has(id)) lastAudibleRef.current.delete(id);
    }
  }, [peers]);

  /**
   * The machine is back on a network. Stop waiting out a guess.
   *
   * The retry backoff is arithmetic about a network nobody can observe, and
   * `online` is the one moment the browser observes it for us. Without this a
   * member who reconnects their Wi-Fi four seconds into a twenty-second cadence
   * sits out the remaining sixteen for no reason — and every peer does, so the
   * room comes back a good deal slower than the network did.
   *
   * Only the connections that are actually in trouble: a healthy peer needs no
   * ICE restart, and offering one would cost a renegotiation to fix nothing.
   */
  useEffect(() => {
    if (!sessionLive) return;
    const onOnline = () => {
      peersRef.current.forEach((pc, peerId) => {
        if (pc.connectionState === "connected" || pc.connectionState === "closed") return;
        const state = recoveryRef.current.get(peerId);
        if (state) recoveryRef.current.set(peerId, withImmediateRetry(state));
        recoverPeerRef.current(peerId);
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sessionLive]);

  // ── Bandwidth adaptation ──────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionLive) return;
    const CHECK_INTERVAL = 4000;

    // Per stat id, so a stream that comes and goes doesn't read as a cliff.
    let prev: Record<string, { bytes: number; received: number; lost: number }> = {};
    let prevTs = Date.now();
    // What we were asking each peer for when the last sample was taken. A tier
    // that changed since then makes this round's rate a measurement of the
    // change rather than of the line.
    let prevTiers = new Map<string, VideoTier>();
    // getStats on a roomful of connections is not instant, and two rounds
    // running at once would each read the other's half-written `prev`.
    let inFlight = false;

    const check = async () => {
      if (inFlight) return;
      const entries = [...peersRef.current.entries()];
      if (!entries.length) return;

      const now = Date.now();
      const elapsed = (now - prevTs) / 1000;
      if (elapsed <= 0) return;
      inFlight = true;
      prevTs = now;

      let received = 0;
      let lost = 0;
      const seen: typeof prev = {};
      const rates: PeerInboundRate[] = [];
      const tiers = new Map<string, VideoTier>();
      const expectingVideoFrom = new Set<string>();

      try {
        for (const [peerId, pc] of entries) {
          const asked = sentRequestRef.current.get(peerId) ?? "high";
          tiers.set(peerId, asked);

          // Expecting video means we asked for it AND they say they are
          // sending it. Both halves are load-bearing: without the first, a
          // backgrounded tab expects the video it just cancelled; without the
          // second, a room with every camera off reads as a starved one.
          // Unknown counts as sending — the announcement lands a moment after
          // a peer appears, and assuming video is the cautious half.
          const said = peerVideoRef.current.get(peerId);
          if (asked !== "none" && (said ? said.camOn && !said.paused : true)) {
            expectingVideoFrom.add(peerId);
          }

          let peerBits = 0;
          // Only a peer we have two samples of has a rate at all. A newcomer
          // reads as zero otherwise, which is indistinguishable from starved.
          let comparable = false;
          try {
            const stats = await pc.getStats();
            stats.forEach((st) => {
              if (st.type !== "inbound-rtp") return;
              const s2 = st as RTCInboundRtpStreamStats;
              const id = s2.id;
              const bytes = s2.bytesReceived ?? 0;
              const packets = s2.packetsReceived ?? 0;
              // packetsLost is signed and can go backwards after a correction.
              const packetsLost = Math.max(0, s2.packetsLost ?? 0);
              seen[id] = { bytes, received: packets, lost: packetsLost };
              const was = prev[id];
              if (!was) return;
              comparable = true;
              peerBits += Math.max(0, bytes - was.bytes) * 8;
              received += Math.max(0, packets - was.received);
              lost += Math.max(0, packetsLost - was.lost);
            });
          } catch { continue; /* a connection closing mid-poll */ }

          // A peer whose tier moved during the window is mid-transition: its
          // encoder is starting up or shutting down, and neither rate is a
          // statement about the network.
          if (comparable && prevTiers.get(peerId) === asked) {
            rates.push({ id: peerId, kbps: peerBits / 1000 / elapsed });
          }
        }
      } finally {
        inFlight = false;
      }

      prev = seen;
      prevTiers = tiers;

      const sample = summarizeInbound({ rates, expectingVideoFrom, lostPackets: lost, deliveredPackets: received + lost });

      const before = linkRef.current.mode;
      linkRef.current = stepLink(linkRef.current, sample);
      const after = linkRef.current.mode;
      if (after === before) return;

      // The mode is the *budget*, applied at the sender. The camera, the local
      // preview and the camera button are left exactly as the member set them:
      // the version this replaced disabled the local video track outright, so a
      // bad ten seconds turned someone's own picture off and left the button
      // claiming it was on.
      bwModeRef.current = after;
      setBwMode(after);
      applySendCapsRef.current();
      announceVideoStateRef.current();
    };

    bwCheckRef.current = setInterval(() => { void check(); }, CHECK_INTERVAL);
    return () => { if (bwCheckRef.current) clearInterval(bwCheckRef.current); };
  }, [sessionLive]);

  // ── Transcript flush ──────────────────────────────────────────────────────

  /**
   * Post this device's unsaved words, and remember which ones landed.
   *
   * Everything about the old version of this lost speech. It wrote through the
   * Supabase client straight at the table, which an invite-link guest is not
   * allowed to do — their session is nobody, RLS said no, and nothing surfaced
   * it. It saved every line in the array rather than its own, so each sentence
   * was stored once per participant. It tracked progress as an INDEX into an
   * array that remote lines splice into the middle of, so the mark slid over
   * unsaved lines and back across saved ones. And it advanced that mark before
   * the write resolved and never looked at the result, so a failed insert
   * simply deleted those words from history.
   *
   * What replaces it: own lines only, keyed by id rather than position, and an
   * id is forgotten only once the server has confirmed it. Which means a flush
   * may safely be retried — the rows carry their own primary keys, so a retry
   * conflicts instead of duplicating.
   *
   * `keepalive` is for the unload path, where the document is going away and an
   * ordinary fetch is cancelled with it. The browser caps a keepalive body at
   * 64KB; MAX_BATCH sits far inside that.
   */
  const flushTranscript = useCallback(async (opts: { keepalive?: boolean } = {}): Promise<boolean> => {
    const mId = meetingIdRef.current;
    if (!mId) return true;
    const pending = pendingLines(transcriptRef.current, savedLineIdsRef.current);
    if (!pending.length) return true;
    const batch = nextBatch(pending, MAX_BATCH);

    const query = isGuestRef.current && guestKeyRef.current
      ? `?guestKey=${encodeURIComponent(guestKeyRef.current)}`
      : "";
    try {
      const res = await fetch(`/api/meetings/${mId}/transcript${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: transcriptRows(batch, mId) }),
        keepalive: opts.keepalive === true,
      });
      if (!res.ok) { flushFailuresRef.current += 1; return false; }
      // Marked saved from the batch we sent rather than from the response, so a
      // reply that is lost in transit still retires the lines the server has:
      // re-sending them would be harmless anyway, and the failure mode worth
      // avoiding is the one where nothing ever retires and the batch never
      // reaches the end of a long meeting.
      for (const line of batch) savedLineIdsRef.current.add(line.id);
      flushFailuresRef.current = 0;
      return true;
    } catch {
      flushFailuresRef.current += 1;
      return false;
    }
  }, []);

  const flushTranscriptRef = useRef(flushTranscript);
  useEffect(() => { flushTranscriptRef.current = flushTranscript; }, [flushTranscript]);

  /**
   * Keep flushing until nothing is owed.
   *
   * One flush sends at most MAX_BATCH lines, which is the right bound for the
   * periodic path — the next tick takes the rest — and the wrong one for the
   * last flush of a meeting, where there is no next tick. A call whose writes
   * had been failing can reach the end holding hundreds of unsaved lines, and a
   * single batch would save fifty of them and lose the rest.
   *
   * Bounded twice over: it stops when a flush fails, and it stops after enough
   * rounds to carry any meeting a browser could hold. Neither is expected to
   * bite; both are here because this runs while somebody is waiting for a
   * report and an unbounded loop would hold them there.
   */
  const drainTranscript = useCallback(async (): Promise<void> => {
    for (let round = 0; round < 20; round++) {
      if (!pendingLines(transcriptRef.current, savedLineIdsRef.current).length) return;
      if (!(await flushTranscriptRef.current())) return;
    }
  }, []);

  // A timer that reschedules itself rather than a fixed interval, so a failing
  // flush can back off instead of hammering a connection that is already gone —
  // and so it comes straight back to the normal cadence once it recovers.
  useEffect(() => {
    if (!sessionLive || !meetingId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = async () => {
      await flushTranscriptRef.current();
      if (stopped) return;
      timer = setTimeout(() => { void tick(); }, nextFlushDelay(flushFailuresRef.current));
    };
    timer = setTimeout(() => { void tick(); }, nextFlushDelay(0));

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // The last words of a meeting are the ones worth having, and they are
      // exactly the ones a plain interval never reaches: it is cleared on the
      // way out with up to a full period still unsaved. This is not reliable on
      // its own — the request outlives the component but not the document — so
      // the pagehide listener below covers a closing tab.
      void flushTranscriptRef.current({ keepalive: true });
    };
  }, [sessionLive, meetingId]);

  // Closing the tab is the most common way a meeting ends, and the least
  // graceful. `pagehide` rather than `beforeunload` for the same reason the
  // departure record uses it: it fires on mobile Safari's back-forward cache
  // path, where beforeunload does not.
  useEffect(() => {
    if (!sessionLive) return;
    const onHide = () => { void flushTranscriptRef.current({ keepalive: true }); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [sessionLive]);

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * The live room, as the composer reads it.
   *
   * Every field is a function over refs rather than a value, because this is
   * read on every drawn frame — twenty-four times a second — and a snapshot
   * rebuilt on each render would either be stale between renders or force one
   * per frame. Memoised with no dependencies for the same reason: the composer
   * holds this object for the length of the recording, and swapping it out
   * under a running encoder is how a recording loses its audio halfway through.
   */
  const recordingRoom = useMemo<RoomSnapshot>(() => ({
    get participants() {
      return [
        {
          id: LOCAL_SPEAKER_ID,
          displayName: localNameRef.current,
          hasVideo: camOnRef.current || shareOnRef.current,
        },
        ...[...peersDataRef.current.values()].map((p) => ({
          id: p.id,
          displayName: p.displayName,
          // A peer whose camera is off, or whose video the link has paused, is
          // drawn as a name card. Assumed live when they have said nothing yet:
          // everyone joins with a camera, and a blank card for somebody who is
          // on screen is the worse error.
          hasVideo: peerVideoRef.current.get(p.id)?.camOn ?? true,
        })),
      ];
    },
    get activity() {
      // The same log the transcript uses to decide who said what, read over the
      // last two seconds. Reusing it means the recording cuts to the person the
      // transcript is about to credit, rather than to a second opinion.
      const now = Date.now();
      return voiceLogRef.current.summarize(now - 2_000, now)
        .map((a) => ({ speakerId: a.speakerId, share: a.share }));
    },
    get screenSharerId() {
      if (shareOnRef.current) return LOCAL_SPEAKER_ID;
      // First in iteration order, which is join order. Two people sharing at
      // once is already an argument the room is having; the recording does not
      // have to arbitrate it.
      for (const id of sharingPeersRef.current) {
        if (peersDataRef.current.has(id)) return id;
      }
      return null;
    },
    streamFor: (id: string) => (
      id === LOCAL_SPEAKER_ID
        ? localStreamRef.current
        : remoteStreamsRef.current.get(id) ?? null
    ),
    screenStream: () => (
      // A local share has replaced the camera track in the local stream, so it
      // IS the local stream. A remote share arrives as that peer's ordinary
      // stream; nothing distinguishes it except the flag they broadcast.
      shareOnRef.current
        ? localStreamRef.current
        : (() => {
            for (const id of sharingPeersRef.current) {
              const stream = remoteStreamsRef.current.get(id);
              if (stream) return stream;
            }
            return null;
          })()
    ),
    audioStreams: () => [
      // The host's own microphone never crosses a peer connection, so it has to
      // be mixed in from the local stream or the recording is everyone except
      // the person who made it.
      ...(localStreamRef.current ? [localStreamRef.current] : []),
      ...[...remoteStreamsRef.current.values()],
    ],
  }), []);

  const announceRecording = useCallback((on: boolean) => {
    setRoomRecording(on ? { by: localNameRef.current } : null);
    sendSignalRef.current({
      type: "recording",
      from: myIdRef.current,
      recording: on,
      by: localNameRef.current,
    });
  }, []);

  // The room's own capture: a canvas of the tiles plus a mix of everyone's
  // audio. The one-way recorder passes a different source to the same hook.
  const createRoomSource = useCallback(
    (handlers: ComposerHandlers) => new RecordingComposer(recordingRoom, handlers),
    [recordingRoom],
  );

  const recorder = useRecording({
    supabase,
    meetingId,
    hostName: localName,
    createSource: createRoomSource,
    announce: announceRecording,
    // The record button keeps its own clock from `startedAt`.
    tickElapsed: false,
  });

  // A late joiner has missed the broadcast that started the recording, and
  // would sit in a recorded meeting with no badge. Re-announced whenever
  // somebody new arrives, which is the only moment the room's knowledge and
  // the room's membership disagree.
  const recorderStateRef = useRef(recorder.state);
  useEffect(() => { recorderStateRef.current = recorder.state; }, [recorder.state]);
  useEffect(() => {
    if (recorderStateRef.current !== "recording") return;
    sendSignalRef.current({
      type: "recording",
      from: myIdRef.current,
      recording: true,
      by: localNameRef.current,
    });
  }, [peers.size]);

  // Stopping is not optional. A recording left running after the meeting ends
  // is a row that claims to be live until the sweep closes it six hours later,
  // and parts that stop arriving with nothing marking where they stopped.
  const recorderStopRef = useRef(recorder.stop);
  useEffect(() => { recorderStopRef.current = recorder.stop; }, [recorder.stop]);
  useEffect(() => () => { recorderStopRef.current(); }, []);

  /** What this participant is shown — the host's own state, or the room's broadcast. */
  const recordingBanner: { state: RecordingState; by: string } | null =
    recorder.state !== "idle"
      ? { state: recorder.state, by: localName }
      : roomRecording
        ? { state: "recording" as RecordingState, by: roomRecording.by }
        : null;

  const bannerState = recordingBanner?.state ?? "idle";
  useEffect(() => {
    if (bannerState !== "recording") return;
    setRecordingNoticeOpen(true);
    const timer = setTimeout(() => setRecordingNoticeOpen(false), RECORDING_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [bannerState]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    // Derived from the ref rather than inside the state updater: the updater has
    // to stay pure (React calls it twice in StrictMode), and the broadcast and
    // ref write below are both side effects.
    const next = !micOnRef.current;

    // Nothing to enable. The camera's toggle has always known to open a device
    // in this case; the microphone's never did, and the consequences were worse
    // than silence. It flipped the control to "on", cleared the watcher that was
    // trying to get the device back, and broadcast `micOn: true` -- so a guest
    // who denied the permission prompt pressed "Unmute", was shown as live, was
    // reported to the host as live, and sat in a meeting that was waiting for
    // them. Every signal in the product agreed with the wrong answer.
    //
    // So the press means what it can deliver: go and ask for the device.
    if (next && !toggleCanDeliver(micStandingRef.current)) {
      void reacquireMicRef.current().catch(() => { /* reported by the banner */ });
      return;
    }

    micOnRef.current = next;
    // Their decision now, not the join's. Whatever the room was going back for
    // on their behalf stops here — a device that reappears must not undo a
    // member who has just chosen to be muted.
    micIntentRef.current = next;
    setMicToRecover(null);
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicOn(next);
    if (!next) lastAudibleRef.current.delete(LOCAL_SPEAKER_ID);
    // Everyone else needs this to know whether our silence means "listening" or
    // "muted" — and to keep their own recognizer from crediting us with words we
    // could not have said.
    sendSignalRef.current({ type: "mic", from: myIdRef.current, micOn: next, displayName: localNameRef.current });
  }, []);

  const toggleCam = useCallback(() => {
    // Derived from the ref, like toggleMic: the ref write is a side effect and
    // does not belong inside a state updater.
    const next = !camOnRef.current;

    // WHICH tracks this touches is the whole of it. During a screen share the
    // local stream's only video track IS the screen — toggleScreen takes the
    // camera off the stream entirely — so flipping `enabled` across the stream
    // blanked the share for the entire room. Every viewer got black frames
    // while the browser still lit its "sharing" indicator, the button still
    // read "Stop sharing", and `announceVideoState` still reported the video
    // live (it ORs in shareOn), so nobody even fell back to a name card. The
    // one person who could not see it was the presenter, whose own tile is the
    // screen. reacquireCamera has always known not to touch the wire mid-share;
    // the manual toggle never learned.
    //
    // So while sharing this moves the camera's own track, which is off the wire
    // and held in the refs, and records an intention that restoreCameraTrack
    // applies when the share ends.
    const sharing = shareOnRef.current;
    const camera = cameraTrackRef.current;
    const live = sharing
      ? camera?.readyState === "live"
      : localStreamRef.current?.getVideoTracks().some((t) => t.readyState === "live") ?? false;

    // Turning on with nothing to turn on. `enabled` only means something to a
    // track that exists, and a track that has ended is no better than none.
    // Safe mid-share: adoptCameraTrack keeps its hands off the senders while
    // shareOn, so this readies a camera for when the share ends rather than
    // interrupting it.
    if (next && !live) {
      void startCameraRef.current();
      return;
    }
    camOnRef.current = next;
    camWantedRef.current = next;
    setCameraToRecover(null);
    if (sharing) { if (camera) camera.enabled = next; }
    else localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
    setCamOn(next);
    // A disabled track still sends black frames at a cost, and those black
    // frames are all the far end had to go on — so stop the stream at the
    // sender and say why, rather than paying to transmit a black rectangle.
    applySendCapsRef.current();
    announceVideoStateRef.current();
  }, []);

  /**
   * Put one video track on the wire: every peer sender, the local stream, and
   * the tile that renders it.
   *
   * `stopOutgoing` is the whole reason this is a single function. A screen share
   * that ends should have its track stopped — it is finished. The camera track
   * feeding a background effect must not be, because the processor is still
   * reading from it; stopping it there is a black canvas and no way back
   * without asking for the camera again.
   */
  const swapOutgoingVideo = useCallback((next: MediaStreamTrack | null, stopOutgoing: boolean) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    // A null `next` means SEND NOTHING, and it has to mean that rather than
    // "do nothing". This used to return early on it, and the case that reaches
    // it is not rare: a member sharing their screen with their camera off.
    // Ending that share called restoreCameraTrack, which passes the camera
    // track — null for them — so the screen track was never replaced on the
    // senders and never stopped. `shareOn` went false, the button said
    // "Share screen", the room was told sharing had ended, and the screen kept
    // going out to every participant with the browser's own sharing indicator
    // still lit. The one person who could not tell was the one sharing.
    if (next) next.contentHint = contentHintFor(shareOnRef.current ? "screen" : "camera");
    // The sender held from the transceiver, not one found by looking for a track
    // that is already video: someone who joined with their camera off has a
    // video sender carrying nothing, and searching by track kind skipped it —
    // so their camera, their background and their screen never went anywhere.
    videoSenderRef.current.forEach((sender) => { void sender.replaceTrack(next).catch(() => { /* peer closed */ }); });
    stream.getVideoTracks().forEach((t) => {
      if (t !== next) { if (stopOutgoing) { try { t.stop(); } catch { /* already stopped */ } } stream.removeTrack(t); }
    });
    if (next && !stream.getVideoTracks().includes(next)) stream.addTrack(next);
    // The camera may have been toggled off while this track was not on the wire.
    if (next) next.enabled = camOnRef.current;
    setLocalStream(new MediaStream(stream.getTracks()));
    applySendCapsRef.current();
  }, []);

  /**
   * Adopt a track the mask driver has just started producing.
   *
   * The one thing the room has to do differently for `MaskDriver`. A
   * `BackgroundProcessor` had a fixed output track, so the swap happened once
   * where it was built. A driver's output changes: the room starts on a
   * main-thread composite so nobody ever sees a black tile, and moves to the
   * worker's output when a real frame has arrived from it. Both arrive here.
   */
  const onMaskTrack = useCallback((track: MediaStreamTrack) => {
    cameraTrackRef.current = track;
    // Mid-share the camera is off the wire entirely, and restoreCameraTrack is
    // what puts it back -- from this same ref, which has just been updated.
    // Touching the senders here would replace the screen somebody is presenting
    // with their face. Read from the ref rather than the state: this callback is
    // handed to the driver once and outlives every render.
    if (shareOnRef.current) return;
    // `false`, emphatically. The driver owns the lifetime of every track it
    // hands over, and stopping the one being replaced is how the main-thread
    // composite dies at the exact moment the worker is taking over from it.
    swapOutgoingVideo(track, false);
  }, [swapOutgoingVideo]);
  /** Held in a ref because the driver is given this callback exactly once. */
  const onMaskTrackRef = useRef(onMaskTrack);
  useEffect(() => { onMaskTrackRef.current = onMaskTrack; }, [onMaskTrack]);

  /** Put the camera back on the wire after a screen share ends. */
  const restoreCameraTrack = useCallback(() => {
    shareOnRef.current = false;
    swapOutgoingVideo(cameraTrackRef.current, true);
    setShareOn(false);
    announceVideoStateRef.current();
  }, [swapOutgoingVideo]);

  /**
   * Give up on a background that cannot be delivered, without exposing the room.
   *
   * The camera stays off. Somebody who asked to hide where they are sitting has
   * not consented to the alternative, and quietly sending the real room because
   * a model failed to load is the single worst thing to do on their behalf. The
   * camera button is right there when they decide otherwise.
   *
   * Distinct from the bandwidth and CPU suspensions, which drop a background
   * that was already working, in a call the person is watching, with a notice
   * they can act on immediately.
   */
  const abandonBackground = useCallback((message: string) => {
    bgEffectRef.current = NO_BACKGROUND;
    setBgEffect(NO_BACKGROUND);
    // Set before the swap: swapOutgoingVideo takes the camera's intended state
    // from this ref when it puts a track on the wire.
    camOnRef.current = false;
    setCamOn(false);
    const mask = maskRef.current;
    maskRef.current = null;
    cameraTrackRef.current = rawCameraTrackRef.current;
    if (!shareOn) swapOutgoingVideo(rawCameraTrackRef.current, false);
    mask?.destroy();
    announceVideoStateRef.current();
    setBgNotice(message);
  }, [shareOn, swapOutgoingVideo]);

  /**
   * Apply a background choice to the outgoing video.
   *
   * "None" tears the driver down rather than leaving it idling: segmentation is
   * the expensive part of this feature and nobody who turned it off should still
   * be paying for it. Anything else builds the driver over the raw camera once
   * and thereafter only changes what it paints.
   *
   * "Never touches the peer connections" used to be true of everything but the
   * first build. It no longer is, and that is the point of `MaskDriver`: it
   * starts the room on a main-thread composite and moves it onto a worker's
   * output a beat later, which is one `replaceTrack` per peer. Every swap goes
   * through `onMaskTrack` above rather than being open-coded here, so there is
   * one place that knows how a changing output track reaches the wire.
   */
  const applyBackground = useCallback(async (effect: BackgroundEffect, image?: Blob | null) => {
    bgEffectRef.current = effect;
    setBgEffect(effect);
    try { window.localStorage.setItem(BACKGROUND_PREF_KEY, encodeEffect(effect)); } catch { /* storage disabled */ }

    const raw = rawCameraTrackRef.current;

    if (!needsSegmentation(effect)) {
      const mask = maskRef.current;
      maskRef.current = null;
      cameraTrackRef.current = raw;
      if (!shareOn) swapOutgoingVideo(raw, false);
      // Destroyed only after the camera is back on the wire, so there is no
      // frame where the peers are holding a track nobody is drawing to.
      mask?.destroy();
      setBgNotice(null);
      bgSuspendedRef.current = false;
      return;
    }

    if (!raw) return;

    if (!maskRef.current) {
      if (maskBuildingRef.current) return;
      maskBuildingRef.current = true;
      // The flag is cleared in a finally and the throw is swallowed for the
      // same reason: this guard blocks every future build while it is set, so a
      // canvas or a WASM loader that throws rather than returning null would
      // cost the member their background for the rest of the call — and leave
      // the camera held off the wire by enterRoom with nothing coming to
      // release it. A failure to build is a failure to build, however it is
      // reported.
      /**
       * Whether this attempt is still the one the room wants.
       *
       * It cannot be an identity check against `maskRef.current`: the driver
       * puts a track on the wire from inside `create`, before anything has been
       * assigned anywhere, and the only two ways the room abandons an attempt
       * are the two discards below. A driver the room DID keep is only ever
       * dropped by destroying it, and a destroyed driver announces nothing.
       */
      const attempt = { live: true };
      // Built paused when there is nothing to send. Somebody who joined with
      // their camera off and a remembered background would otherwise composite
      // at 24fps for a wire that discards every frame — and would start the
      // worker's first-frame clock against a worker nobody is going to ask for
      // a frame, which the deadline reads as a broken pipeline and latches.
      // From the refs, not the state: this runs inside an async build that
      // began renders ago.
      const startPaused = !camOnRef.current || shareOnRef.current;
      let mask: MaskDriver | null = null;
      try {
        const { MaskDriver } = await import("@/lib/meetings/mask-driver");
        mask = await MaskDriver.create(raw, bgEffectRef.current, {
          onTrack: (track) => { if (attempt.live) onMaskTrackRef.current(track); },
          onSlowFrames: (consecutive) => {
            if (bgSuspendedRef.current) return;
            const decision = shouldSuspendEffect({ bwMode: bwModeRef.current, consecutiveSlowFrames: consecutive });
            if (!decision.suspend || !decision.reason) return;
            bgSuspendedRef.current = true;
            setBgNotice(suspensionMessage(decision.reason));
            void applyBackgroundRef.current(NO_BACKGROUND);
          },
          onUnavailable: () => {
            setBgUnavailable(true);
            abandonBackgroundRef.current("Background effects couldn't load — your camera is off so your room stays private. Turn it on when you're ready.");
          },
          // Only the phases that settle something: which pipeline the member
          // ended up on, and the reason if it was the main thread. The
          // intermediate ones are churn, and the fallback's whole virtue is
          // that nothing it does is visible from anywhere else.
          onPhase: (phase) => {
            if (phase.phase === "worker" || phase.phase === "main") {
              console.info("[meeting] mask pipeline", phase);
            }
          },
          onStats: (report) => {
            maskReportsRef.current += 1;
            // The first report, then once a minute — the worker reports once a
            // second. Enough to read the readback cost off a real call without
            // turning a long meeting into a log.
            if (maskReportsRef.current === 1 || maskReportsRef.current % 60 === 0) {
              console.info("[meeting] mask worker timing", report);
            }
          },
        }, null, startPaused);
      } catch (err) {
        console.warn("[meeting] mask driver failed to build", err);
      } finally {
        maskBuildingRef.current = false;
      }
      if (!mask) {
        attempt.live = false;
        setBgUnavailable(true);
        abandonBackground("Background effects aren't available here — your camera is off so your room stays private. Turn it on when you're ready.");
        return;
      }
      // The choice may have moved on during the build — a 12MB download is long
      // enough for someone to change their mind twice. `destroy` stops the
      // track this driver already put on the wire from inside `create`, and the
      // call that moved the choice on has already swapped the camera back, so
      // the wire is correct before this runs rather than after it.
      //
      // Or the room itself has gone, which the teardown paths cannot catch:
      // they destroy the driver in `maskRef`, and this one was never put there.
      // Destroying it here is what stops its camera clone outliving the call.
      if (tornDownRef.current || !needsSegmentation(bgEffectRef.current)) {
        attempt.live = false;
        mask.destroy();
        return;
      }
      maskRef.current = mask;
    }

    // What is wanted NOW, not what this call was asked for. A pick made while
    // the segmenter was downloading returns early at the guard above — there is
    // a build already in flight and a second one would strand a camera tap — so
    // this call is the only one left that can honour it. Reading the argument
    // instead is how somebody ends up looking at "Terminal" in the picker while
    // the room sees the blur they chose first.
    const wanted = bgEffectRef.current;
    // The blob belongs to the effect it arrived with; a different choice has to
    // be looked up like any remembered one.
    let blob = sameEffect(wanted, effect) ? (image ?? null) : null;
    if (wanted.kind === "custom" && !blob) {
      const stored = await getBackground(wanted.id);
      if (!stored) {
        // Remembered on this account but stored in another browser. Same rule:
        // a background they cannot have does not become the room they are in.
        abandonBackground("That background isn't saved on this device — your camera is off so your room stays private.");
        return;
      }
      blob = stored.blob;
    }
    // One more look: the store read above is another await, and a driver torn
    // down under it must not be spoken to.
    if (!maskRef.current || !needsSegmentation(bgEffectRef.current)) return;

    maskRef.current.setEffect(wanted, blob);
    // Unconditional, and on the build path above it is a repeat of what
    // `onTrack` already did. Left that way deliberately: this is also the path
    // where an effect changes on a driver that was ALREADY running, where no
    // track changed and so nothing was announced, and it is the line the
    // comment on enterRoom's camera hold is about — `swapOutgoingVideo` sets
    // `enabled` from camOnRef as it goes. The repeat costs one `replaceTrack`
    // with the track already on the sender; getting the condition subtly wrong
    // costs a member their video.
    const track = maskRef.current.track;
    if (track) onMaskTrackRef.current(track);
  }, [shareOn, swapOutgoingVideo, abandonBackground]);

  // The processor callbacks are created once but need the current handler, and
  // the handler needs itself to fall back to "none".
  const applyBackgroundRef = useRef(applyBackground);
  useEffect(() => { applyBackgroundRef.current = applyBackground; }, [applyBackground]);
  const abandonBackgroundRef = useRef(abandonBackground);
  useEffect(() => { abandonBackgroundRef.current = abandonBackground; }, [abandonBackground]);

  /**
   * Adopt a newly opened camera device.
   *
   * The driver outlives the camera, which is the whole reason it is a driver and
   * not a processor. `BackgroundProcessor` was bound to the track it was built
   * from, so this used to tear the whole thing down and build another -- and the
   * fallback latch went with it, so a member on a browser where the worker does
   * not work paid a fresh first-frame deadline, and a fresh doomed hand-over,
   * every time they changed camera. `replaceSource` re-attempts on the new
   * device and keeps what was already learned.
   */
  const adoptCameraTrack = useCallback(async (track: MediaStreamTrack) => {
    const previousRaw = rawCameraTrackRef.current;
    rawCameraTrackRef.current = track;
    setRawCameraTrack(track);

    if (!needsSegmentation(bgEffectRef.current)) {
      const mask = maskRef.current;
      maskRef.current = null;
      cameraTrackRef.current = track;
      if (!shareOn) swapOutgoingVideo(track, false);
      // After the swap, as everywhere else: the peers are never left holding a
      // track nobody is drawing to.
      mask?.destroy();
    } else if (maskRef.current) {
      // Awaited for the stop below, and its result deliberately ignored. A main
      // pipeline that will not rebuild reports itself through `onUnavailable`,
      // which is the one place that decides what the member is told and turns
      // their camera off to protect the room. Acting on the return value here
      // as well would mean two notices racing for the same banner, saying
      // different things about the same failure.
      await maskRef.current.replaceSource(track);
    } else {
      // No driver to re-point: joined with the camera off, or an earlier build
      // failed. Build one now, and if that fails applyBackground has already
      // fallen back to the plain camera and set cameraTrackRef itself.
      await applyBackgroundRef.current(bgEffectRef.current);
      if (!maskRef.current) cameraTrackRef.current = track;
    }

    // Last, and only now: `replaceSource` does not resolve until the new
    // pipeline is up, so until here something may still have been reading this.
    if (previousRaw && previousRaw !== track) { try { previousRaw.stop(); } catch { /* already stopped */ } }
  }, [shareOn, swapOutgoingVideo]);

  /**
   * Start a camera for someone who has none.
   *
   * Two ways to arrive here and they are the same problem: joining with the
   * camera off never opens one, and a camera another application held at join
   * time leaves the member with no video track either. In both cases the
   * button used to flip a flag, announce a live camera to the room, and send
   * nothing — so everyone else drew a black tile for a member whose own screen
   * said they were on.
   *
   * No renegotiation: the video transceiver was created when the peer
   * connection was, carrying nothing, so putting a track on it is a
   * replaceTrack. That is also why this works at all mid-call.
   */
  const startCamera = useCallback(async () => {
    setCamStarting(true);
    try {
      const opened = await openCameraOnly({
        // What we were last actually on, which is not necessarily what was
        // asked for at join time — that camera may be the busy one.
        cameraId: selectedCamIdRef.current,
        rememberedCameraId: rememberedDevice("videoinput"),
      });
      if (!opened.track) {
        setMediaError(cameraMessage(opened.outcome.failure ?? "unknown"));
        return;
      }
      // The same hazard as the driver build, one await earlier: a camera opened
      // for a room that has since gone is a camera nothing will stop.
      if (tornDownRef.current) { try { opened.track.stop(); } catch { /* already stopped */ } return; }
      // Before adopting: swapOutgoingVideo takes the track's intended enabled
      // state from this ref, so setting it afterwards would put a disabled
      // track on the wire.
      camOnRef.current = true;
      camWantedRef.current = true;
      setCamOn(true);
      setSelectedCamId(opened.outcome.deviceId ?? "");
      setCameraToRecover(null);
      setMediaError(null);
      await adoptCameraTrack(opened.track);
      applySendCapsRef.current();
      announceVideoStateRef.current();
    } finally {
      setCamStarting(false);
    }
  }, [adoptCameraTrack]);

  // Declared after adoptCameraTrack, which it needs, and reached from toggleCam
  // through this ref — the same forward reference the rest of the room uses.
  const startCameraRef = useRef(startCamera);
  useEffect(() => { startCameraRef.current = startCamera; }, [startCamera]);

  const toggleScreen = useCallback(async () => {
    if (shareOn) { restoreCameraTrack(); return; }
    // The picker stays open as long as the member likes, and `shareOn` is false
    // that whole time — so a second press opened a SECOND picker. Both
    // resolving left the first capture running: taken off the stream without
    // being stopped, delivered to nobody, with the browser still telling the
    // member that surface was being shared, until the tab closed. The camera
    // button has had this guard since it grew one; this one never did.
    if (sharePendingRef.current) return;
    sharePendingRef.current = true;
    setShareStarting(true);
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints());
      const screenTrack = screenStream.getVideoTracks()[0];
      // Giving up has to stop the capture. Abandoning the stream — which is
      // what happened when the call was torn down while the picker was open —
      // leaves a capture nobody holds a reference to and an indicator nobody
      // can clear.
      if (!screenTrack || !localStreamRef.current) {
        screenStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
        return;
      }
      screenTrack.contentHint = contentHintFor("screen");
      // Set before the caps are applied: sharing has its own budget, and a
      // member sharing with their camera off is still sending video.
      shareOnRef.current = true;
      videoSenderRef.current.forEach((sender) => { void sender.replaceTrack(screenTrack).catch(() => { /* peer closed */ }); });
      const stream = localStreamRef.current;
      stream.getVideoTracks().forEach((t) => {
        stream.removeTrack(t);
        // A camera track is kept alive deliberately: a background processor may
        // still be reading it, and it goes back on the wire when the share
        // ends. Anything else here is a capture that is finished, and leaving
        // one running is the leak this whole guard is about.
        if (t !== cameraTrackRef.current && t !== rawCameraTrackRef.current) {
          try { t.stop(); } catch { /* already stopped */ }
        }
      });
      stream.addTrack(screenTrack);
      setLocalStream(new MediaStream(stream.getTracks()));
      setShareOn(true);
      applySendCapsRef.current();
      announceVideoStateRef.current();
      // Stopping from the browser's own "Stop sharing" bar used to call back into
      // this same closure, where `shareOn` was still false — so instead of putting
      // the camera back it opened the screen picker again. Restore directly.
      screenTrack.onended = () => restoreCameraTrack();
    } catch { /* user cancelled the picker */ }
    finally {
      sharePendingRef.current = false;
      setShareStarting(false);
    }
  }, [shareOn, restoreCameraTrack]);

  /**
   * Move the call onto another microphone.
   *
   * Three things here are not incidental:
   *
   * `constraintsFor` rather than a bare deviceId — the raw request dropped echo
   * cancellation, noise suppression and gain control, which are exactly what
   * keep a laptop mic in a hard room usable. Switching mics used to introduce
   * echo to a call that did not have any.
   *
   * `enabled = micOnRef.current` — a fresh track arrives live. A muted member
   * who changed microphones was put back on the wire mid-sentence while the
   * button still read "muted". `swapOutgoingVideo` has always done this for the
   * camera; the audio path simply never had a counterpart.
   *
   * Remembering the choice — the green room writes the preference and this did
   * not, so a mid-call switch to a headset was forgotten by the next call.
   */
  const switchMic = useCallback(async (deviceId: string) => {
    let opened: MediaStream | null = null;
    // The microphone has no async hand-over, so there is no window between
    // opening and owning -- but the release is written the same way as the two
    // camera paths so the three cannot drift, and so a `stop()` on a track that
    // already ended stops being reported as "that microphone could not be
    // opened".
    let adopted = false;
    try {
      opened = await navigator.mediaDevices.getUserMedia({
        audio: constraintsFor("audioinput", deviceId || null),
        video: false,
      });
      const t = opened.getAudioTracks()[0];
      if (!t || !localStreamRef.current) return;
      // A microphone left open after the call is the same fault as a camera,
      // minus the indicator light that would have told them. See `flipCamera`.
      if (tornDownRef.current) return;
      t.enabled = micOnRef.current;
      t.contentHint = contentHintFor("microphone");
      audioSenderRef.current.forEach((sender) => { void sender.replaceTrack(t).catch(() => { /* peer closed */ }); });
      adopted = true;
      localStreamRef.current.getAudioTracks().forEach((t2) => { try { t2.stop(); } catch { /* already stopped */ } localStreamRef.current!.removeTrack(t2); });
      localStreamRef.current.addTrack(t);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      // The id the track REPORTS, not the one requested. "" is a request for
      // the system default and resolves to a concrete device, so recording what
      // was asked for would leave the picker unable to tick anything.
      setSelectedMicId(t.getSettings().deviceId || deviceId);
      rememberDevice("audioinput", deviceId);
      setMicToRecover(null);
      setMediaError(null);
    } catch (e) {
      console.warn("[switchMic]", e);
      // Silence is the failure mode here, and silence looks exactly like
      // nobody talking. Say so rather than leaving them on a dead mic.
      setMediaError("That microphone could not be opened. Your previous one is still live.");
    } finally {
      if (!adopted) releaseStream(opened);
    }
  }, []);

  /** The same, for the camera. `adoptCameraTrack` re-attaches any background effect. */
  const switchCam = useCallback(async (deviceId: string) => {
    let opened: MediaStream | null = null;
    // See `flipCamera`: the same hand-over, and the same reason the release has
    // to be conditional on it having happened.
    let adopted = false;
    try {
      opened = await navigator.mediaDevices.getUserMedia({
        // Without these the new camera comes up at its own idea of a sensible
        // resolution — 4K on some webcams — and on a mesh call every
        // participant uploads a copy of it to every other participant.
        video: constraintsFor("videoinput", deviceId || null),
        audio: false,
      });
      const t = opened.getVideoTracks()[0];
      if (!t || !localStreamRef.current) return;
      // See `flipCamera`: a non-null local stream is not evidence the room is
      // still here, and an adopted camera in a dead room is one nothing stops.
      if (tornDownRef.current) return;
      await adoptCameraTrack(t);
      adopted = true;
      setSelectedCamId(t.getSettings().deviceId || deviceId);
      rememberDevice("videoinput", deviceId);
      setCameraToRecover(null);
      setMediaError(null);
    } catch (e) {
      console.warn("[switchCam]", e);
      setMediaError("That camera could not be opened. Your previous one is still live.");
    } finally {
      if (!adopted) releaseStream(opened);
    }
  }, [adoptCameraTrack]);

  /**
   * Move call audio to another output device, and say so if that breaks echo
   * cancellation.
   *
   * The browser's echo canceller works by subtracting what is being PLAYED
   * from what is being CAPTURED, and it has that reference for its own default
   * render device. `setSinkId` moves the audio off that device and the capture
   * does not follow — so sound comes out of a speaker the canceller cannot
   * hear, nothing is subtracted, and everyone else starts hearing themselves
   * back. The member who caused it is the one person who cannot hear it.
   *
   * Exactly the shape of bug `switchMic` carried until it was fixed: a device
   * picker quietly dropping echo cancellation. That was the input side; this is
   * the output side, which was never looked at.
   *
   * Reported, not refused. A member routing audio to a conference speakerphone
   * usually has a reason, and some of that hardware cancels better than the
   * browser does. `echoRisk` is also the one place that can say "a headset" out
   * loud, because `groupId` makes it a fact rather than a guess at a product
   * name.
   *
   * The enumeration is here rather than held in state because this is the only
   * moment the answer matters, and it is a deliberate click rather than
   * anything on the frame path.
   */
  const switchSpeaker = useCallback(async (deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    rememberDevice("audiooutput", deviceId);
    await applySpeakerSink(deviceId);

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const notice = echoRiskNotice(echoRisk({
        micId: selectedMicIdRef.current,
        speakerId: deviceId,
        devices: all.map((d) => ({ deviceId: d.deviceId, groupId: d.groupId })),
      }));
      // Never over an echo the detector has actually OBSERVED: that is
      // evidence, and this is a prediction about hardware.
      if (notice) setEchoNotice((held) => (held === ECHO_DETECTED_NOTICE ? held : notice));
    } catch { /* enumeration refused; the detector is still watching */ }
  }, [applySpeakerSink]);

  /**
   * Recover from a device that disappeared mid-call.
   *
   * Unplugging a headset ends its track. WebRTC keeps the sender attached to
   * that dead track quite happily, so the call carries on looking normal while
   * the member is inaudible — and the only clue is other people saying they
   * cannot hear them. Falling back to the system default is what a native
   * client does, and it is nearly always the right guess: whatever the laptop
   * switched to when the headset came out.
   *
   * Deliberately not remembering the fallback: the member did not choose it,
   * and writing it over their real preference would mean plugging the headset
   * back in no longer restored it next call.
   */
  useEffect(() => {
    if (!ready) return;
    const stream = localStreamRef.current;
    if (!stream) return;

    const audio = stream.getAudioTracks()[0];
    // The CAMERA, not whatever the room is currently sending. Those are the
    // same track only when no background effect is on; with one, the stream
    // carries the composited canvas and the camera behind it is reachable only
    // here. Watching the stream meant that turning on a background quietly
    // detached this recovery — so the members most likely to be on a laptop
    // webcam, in the feature this product leads with, were the ones with no
    // recovery at all. It also meant the listener was attached exactly once:
    // every camera after the first, whether from the picker or from this very
    // fallback, died unnoticed.
    const video = rawCameraTrack;

    const onAudioEnded = () => {
      setMediaError("Your microphone disconnected. Switching to the system default…");
      void switchMic("");
    };
    const onVideoEnded = () => {
      if (!camOnRef.current) return;
      setMediaError("Your camera disconnected. Switching to the system default…");
      void switchCam("");
    };

    audio?.addEventListener("ended", onAudioEnded);
    video?.addEventListener("ended", onVideoEnded);
    return () => {
      audio?.removeEventListener("ended", onAudioEnded);
      video?.removeEventListener("ended", onVideoEnded);
    };
  }, [ready, localStream, rawCameraTrack, switchMic, switchCam]);

  // ── Going back for a device the meeting started without ───────────────────
  //
  // A join is allowed to succeed without a camera or a microphone: landing in
  // the room with a message beats not landing at all. But the failure that
  // dominates is a camera another application is still holding, and that
  // condition ends — usually within seconds of the member quitting the Zoom
  // they were told about. Nothing used to be watching for the moment it did, so
  // they sat out the meeting on a black tile beside a button they did not know
  // to press.
  //
  // What each failure is worth, and what to wait for, is decided by watchFor;
  // the waiting itself is startReacquire. Both loops stop themselves the
  // instant the device is back, and the effects below stop them whenever the
  // member takes the device into their own hands — the one thing this must
  // never fight.

  const reacquireCamera = useCallback(async () => {
    // Not while sharing: replacing the outgoing track mid-share would cut the
    // screen off, and the camera can just as well be adopted when it stops.
    if (shareOnRef.current) return false;
    const opened = await openCameraOnly({
      cameraId: selectedCamIdRef.current,
      rememberedCameraId: rememberedDevice("videoinput"),
    });
    if (!opened.track) return false;
    camOnRef.current = true;
    setCamOn(true);
    setSelectedCamId(opened.outcome.deviceId ?? "");
    await adoptCameraTrack(opened.track);
    applySendCapsRef.current();
    announceVideoStateRef.current();
    return true;
  }, [adoptCameraTrack]);

  const reacquireMic = useCallback(async () => {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: constraintsFor("audioinput", selectedMicIdRef.current || null),
      video: false,
    });
    const track = s.getAudioTracks()[0];
    if (!track || !localStreamRef.current) { s.getTracks().forEach((x) => x.stop()); return false; }
    // The state the member asked for before the hardware had its say. A mic
    // recovered for somebody who joined muted stays muted; one recovered for
    // somebody who joined unmuted and never touched the button goes live,
    // because that is what they asked for and were denied by a device.
    const live = micIntentRef.current;
    track.enabled = live;
    track.contentHint = contentHintFor("microphone");
    audioSenderRef.current.forEach((sender) => { void sender.replaceTrack(track).catch(() => { /* peer closed */ }); });
    const stream = localStreamRef.current;
    stream.getAudioTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } stream.removeTrack(t); });
    stream.addTrack(track);
    setLocalStream(new MediaStream(stream.getTracks()));
    setSelectedMicId(track.getSettings().deviceId || "");
    micOnRef.current = live;
    setMicOn(live);
    // Everyone else has been drawing this member as muted. Only the signal
    // corrects that; the track arriving is invisible to them.
    sendSignalRef.current({ type: "mic", from: myIdRef.current, micOn: live, displayName: localNameRef.current });
    return true;
  }, []);

  const reacquireCameraRef = useRef(reacquireCamera);
  useEffect(() => { reacquireCameraRef.current = reacquireCamera; }, [reacquireCamera]);
  const reacquireMicRef = useRef(reacquireMic);
  useEffect(() => { reacquireMicRef.current = reacquireMic; }, [reacquireMic]);

  useEffect(() => {
    if (!sessionLive || !cameraToRecover) return;
    const watch = watchFor(cameraToRecover);
    if (watch === "never") return;
    return startReacquire({
      watch,
      permissionName: "camera",
      attempt: () => reacquireCameraRef.current(),
      onRecovered: () => {
        setCameraToRecover(null);
        setMediaError(null);
      },
    });
  }, [sessionLive, cameraToRecover]);

  useEffect(() => {
    if (!sessionLive || !micToRecover) return;
    const watch = watchFor(micToRecover);
    if (watch === "never") return;
    return startReacquire({
      watch,
      permissionName: "microphone",
      attempt: () => reacquireMicRef.current(),
      onRecovered: () => {
        setMicToRecover(null);
        setMediaError(null);
      },
    });
  }, [sessionLive, micToRecover]);

  // ── Is the camera actually on? ────────────────────────────────────────────
  //
  // For a reported failure with no single reproducible cause: a member sets
  // their camera up in the green room, the meeting starts, and it is live for
  // nobody — including them — until they open device settings and pick the same
  // camera again. It happens on every join path, with and without a background.
  //
  // There are at least four ways to land in that state and they look identical
  // from here: a device that was asked for again before its driver let go, a
  // track that had already ended, a track left DISABLED by the background hold
  // when the route out of it did not re-enable it, and a preview adopted that
  // was never live. Chasing which one is the wrong shape of fix, because the
  // member's own repair — open settings, pick the camera — works for all of
  // them. So the room does that itself, once, a couple of seconds in.
  //
  // Deliberately late: a freshly opened track is briefly not producing, and the
  // background hold is released only when a 12MB segmenter lands, so judging
  // either immediately would condemn a camera that is merely starting.
  // Deliberately one-shot: this is a safety net under a path that is supposed
  // to work. Anything still wrong afterwards belongs to the re-acquisition
  // loop, and anything that breaks later to the device-loss listener.
  useEffect(() => {
    if (!sessionLive) return;
    const timer = setTimeout(() => {
      // The camera itself, not what is being sent: with a background effect the
      // outgoing track is the processor's canvas, and a healthy canvas over a
      // dead camera is exactly the state this exists to catch.
      const track = rawCameraTrackRef.current;
      const verdict = cameraVerdict({
        wanted: camWantedRef.current,
        on: camOnRef.current,
        track: track ? { readyState: track.readyState, enabled: track.enabled } : null,
      });
      if (!needsRepair(verdict)) return;
      console.warn("[meeting] camera was not live after joining:", verdict);

      if (repairFor(verdict) === "enable" && track) {
        // Open and working and simply switched off. Reopening would blink the
        // camera light in front of somebody watching their own face and cost a
        // second of black on every other tile, for a fault that is one flag.
        track.enabled = true;
        // The composited track when an effect is on, the camera when it is not.
        const outgoing = cameraTrackRef.current;
        if (outgoing && outgoing !== track) outgoing.enabled = true;
        applySendCapsRef.current();
        announceVideoStateRef.current();
        return;
      }
      // No track, or a dead one. Same repair the member would have reached for,
      // through the same path as the device picker.
      void reacquireCameraRef.current();
    }, CAMERA_CHECK_MS);
    return () => clearTimeout(timer);
  }, [sessionLive]);

  const toggleRaiseHand = useCallback(() => {
    // Same shape as the mic and camera toggles: read the ref, write the ref,
    // then set state and broadcast — no side effects inside a state updater.
    const next = !handRaisedRef.current;
    handRaisedRef.current = next;
    setHandRaised(next);
    sendSignalRef.current({ type: "raise_hand", from: myIdRef.current, raised: next });
  }, []);

  /**
   * Take a reaction off one person, timer and all.
   *
   * The timer is the part that used to be missed. A peer leaving dropped their
   * reaction from the record and left the pending timeout running, so three
   * seconds later an orphan fired against somebody who was no longer in the
   * room.
   */
  const clearReaction = useCallback((who: string) => {
    const timers = reactionTimers.current;
    const running = timers.get(who);
    if (running) { clearTimeout(running); timers.delete(who); }
    setReactions((prev) => withoutReaction(prev, who));
  }, []);

  const clearReactionRef = useRef(clearReaction);
  useEffect(() => { clearReactionRef.current = clearReaction; }, [clearReaction]);

  /** Show one person's reaction, replacing whatever they were showing before. */
  const showReaction = useCallback((who: string, raw: string) => {
    // Bounded here as well as at the sender: the picker offers six emoji, and
    // nothing used to check that what arrived was one of them. See
    // lib/meetings/reactions.ts.
    const emoji = normalizeReaction(raw);
    if (!emoji) return;

    const timers = reactionTimers.current;
    const running = timers.get(who);
    if (running) clearTimeout(running);
    // `at` is local arrival time, and exists so the ticker can show reactions
    // in the order they landed. A record keeps a key where it first appeared
    // when its value is replaced, so key order is the wrong clock.
    setReactions((prev) => ({ ...prev, [who]: { emoji, at: Date.now() } }));
    timers.set(
      who,
      setTimeout(() => {
        timers.delete(who);
        // Returning a fresh object for a key that is not there re-rendered
        // the whole room for nothing. The leave handler already got this
        // right; this one did not. See withoutReaction.
        setReactions((prev) => withoutReaction(prev, who));
      }, REACTION_VISIBLE_MS),
    );
  }, []);

  const showReactionRef = useRef(showReaction);
  useEffect(() => { showReactionRef.current = showReaction; }, [showReaction]);

  // Nothing should survive the component that scheduled it.
  useEffect(() => {
    const timers = reactionTimers.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  const sendReaction = useCallback((raw: string) => {
    const emoji = normalizeReaction(raw);
    if (!emoji) return;
    sendSignalRef.current({ type: "reaction", from: myIdRef.current, emoji, ts: Date.now() });
    showReactionRef.current("local", emoji);
  }, []);

  /**
   * The chat endpoint for this caller — a guest carries their key in the query,
   * exactly as the transcript and ICE paths do.
   */
  const chatUrl = useCallback(() => {
    const key = guestKeyRef.current;
    const suffix = key ? `?guestKey=${encodeURIComponent(key)}` : "";
    return `/api/meetings/${meetingIdRef.current}/chat${suffix}`;
  }, []);

  /**
   * Store one message.
   *
   * Never throws, and its failure is not the sender's problem: `delivery` is
   * about whether the ROOM got it, which the broadcast already answered. This
   * is about whether the record will still have it tomorrow, and the shared id
   * makes a later retry of the same message land in the same row.
   */
  const persistChat = useCallback(async (msg: ChatMessage) => {
    if (!meetingIdRef.current) return;
    try {
      await fetch(chatUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.id, text: msg.text, displayName: msg.displayName }),
        keepalive: true,
      });
    } catch (err) {
      console.warn("[meeting] chat message not stored", err);
    }
  }, [chatUrl]);

  /**
   * The conversation so far.
   *
   * Never throws and never clears: losing the history costs a latecomer what
   * they missed, not their part in the rest of the meeting. Merged rather than
   * assigned — the panel may already hold messages that arrived while this was
   * in flight, and `mergeChat` keeps what the socket said about your own sends.
   */
  const loadChatHistory = useCallback(async () => {
    if (!meetingIdRef.current) return;
    try {
      const res = await fetch(chatUrl(), { cache: "no-store" });
      if (!res.ok) return;
      const { messages } = (await res.json()) as { messages?: ChatMessage[] };
      if (Array.isArray(messages) && messages.length) {
        setChatMessages((prev) => mergeChat(prev, messages));
      }
    } catch (err) {
      console.warn("[meeting] chat history unavailable", err);
    }
  }, [chatUrl]);

  const loadChatHistoryRef = useRef(loadChatHistory);
  useEffect(() => { loadChatHistoryRef.current = loadChatHistory; }, [loadChatHistory]);

  const persistChatRef = useRef(persistChat);
  useEffect(() => { persistChatRef.current = persistChat; }, [persistChat]);

  /**
   * Say something to the room, and say honestly whether it got there.
   *
   * The old version appended the message and fired the broadcast into the
   * dark. Everything after the append is new: the send is awaited, and what it
   * says becomes the message's own state. `sending` is a moment on a healthy
   * socket and a visible one on a sick socket — which is when somebody is most
   * likely to be typing "can you hear me?" into this box.
   *
   * The message is stored as well as broadcast. The broadcast is what makes it
   * immediate; the row is what makes it survive a latecomer, a reload and the
   * end of the meeting. The id is minted here and travels with the message to
   * both, which is what lets a retry be safe in either direction.
   */
  const sendChat = useCallback(async (raw: string) => {
    const text = normalizeChatText(raw);
    if (!text) return;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      from: myIdRef.current,
      displayName: localNameRef.current,
      text,
      ts: Date.now(),
      delivery: "sending",
    };
    setChatMessages((prev) => insertMessage(prev, msg));
    void persistChatRef.current(msg);
    const delivery = await sendSignalAck({
      type: "chat", id: msg.id, from: msg.from, displayName: msg.displayName, text, ts: msg.ts,
    });
    setChatMessages((prev) => markDelivery(prev, msg.id, delivery));
  }, [sendSignalAck]);

  /**
   * Send a failed message again.
   *
   * Without this, telling somebody their message did not arrive just moves the
   * work to them: they retype it, from memory, while the call carries on. The
   * id and timestamp are the original ones, so a retry of a message that DID
   * go out lands as the same message on every screen rather than as a second
   * one — see insertMessage — and as the same ROW rather than a second one.
   */
  const retryChat = useCallback(async (id: string) => {
    const msg = chatMessagesRef.current.find((m) => m.id === id);
    if (!msg || msg.delivery !== "failed") return;
    setChatMessages((prev) => markDelivery(prev, id, "sending"));
    void persistChatRef.current(msg);
    const delivery = await sendSignalAck({
      type: "chat", id: msg.id, from: msg.from, displayName: msg.displayName, text: msg.text, ts: msg.ts,
    });
    setChatMessages((prev) => markDelivery(prev, id, delivery));
  }, [sendSignalAck]);

  /**
   * Whether the chat panel is the thing being looked at.
   *
   * Was set true when the chat tab mounted and cleared only when the whole
   * panel collapsed — so switching to People left it true, and every message
   * that arrived while somebody read the roster counted as read. Nothing said
   * otherwise either: the toolbar badge is suppressed while the panel is open,
   * and the Chat tab had no badge of its own.
   */
  const handleChatVisibility = useCallback((visible: boolean) => {
    chatOpenRef.current = visible;
    if (visible) setChatUnread(0);
  }, []);

  const muteAll = useCallback(() => { sendSignal({ type: "mute_all", from: myIdRef.current }); }, [sendSignal]);

  /**
   * Swap between the front and rear cameras.
   *
   * Three things here were wrong, and all three only bite on a phone -- which
   * is the only place this button appears.
   *
   * It asked for `{ facingMode }` and nothing else, while `switchCam` fifty
   * lines up carried capture bounds and a comment explaining why. On a phone
   * that omission is the worst available, because the rear camera is the
   * highest-resolution sensor on the device: the flip opened a 4K 60fps capture
   * on a mesh call, and nothing downstream undoes it -- `videoSendCap` sets
   * `scaleResolutionDownBy: 1` at any healthy bitrate, so the encoder is told
   * to keep every pixel. The bounds now live in `cameraBounds` so the two
   * callers cannot drift apart again.
   *
   * It leaked the stream on the early return, where both of its siblings stop
   * it. That leaves a second live capture of the same sensor and the hardware
   * light on -- and two captures of one sensor is also how a camera starts
   * hunting its own exposure.
   *
   * And it recorded the side it ASKED for. `facingConstraints` asks rather than
   * demands, because an exact match throws on a one-camera machine, so a flip
   * can legitimately come back with the same camera -- and the button then
   * claimed the rear camera while showing a face.
   */
  const flipCamera = useCallback(async () => {
    const next = facingMode === "user" ? "environment" : "user";
    let opened: MediaStream | null = null;
    // Flipped the instant the hand-over completes, because from then on the
    // track is the ROOM's: releasing it would stop the camera the member is now
    // using. Which is why the release below is conditional rather than
    // unconditional -- it has to cover a throw BEFORE adoption without
    // punishing anything that goes wrong after it.
    let adopted = false;
    try {
      opened = await navigator.mediaDevices.getUserMedia({
        video: facingConstraints(next),
        audio: false,
      });
      const t = opened.getVideoTracks()[0];
      if (!t || !localStreamRef.current) return;
      // The same hazard `startCamera` guards one await earlier, and the reason
      // it cannot lean on the check above: teardown stops the tracks in
      // `localStreamRef.current` but never nulls the ref, so a non-null stream
      // is NOT evidence the room is still there. A capture that resolves after
      // someone leaves -- a permission prompt they answered on the way out, a
      // slow camera -- would otherwise be adopted into a dead room and left
      // running, with the hardware light on, after the call they left.
      if (tornDownRef.current) return;
      await adoptCameraTrack(t);
      adopted = true;
      setSelectedCamId(t.getSettings().deviceId || "");
      setFacingMode(settledFacing(t.getSettings().facingMode, next));
      setMediaError(null);
    } catch (e) {
      console.warn("[flipCamera]", e);
      // Said rather than swallowed, as `switchCam` says it: a flip that fails
      // silently reads as a dead button, and the member cannot tell that the
      // camera they still have is the one they are still sending.
      setMediaError("That camera could not be opened. Your previous one is still live.");
    } finally {
      // One place for every way this can end without handing the track over:
      // no usable track, no local stream, or a throw out of `adoptCameraTrack`.
      // Each of those leaves a live capture and the hardware light on.
      if (!adopted) releaseStream(opened);
    }
  }, [facingMode, adoptCameraTrack]);

  /**
   * Leave, because we have been removed.
   *
   * Reached two ways, which is why it is one function: the host's broadcast,
   * which is immediate and cooperative, and this client's own reading of the
   * meeting's removals, which is what covers a broadcast that never arrived —
   * a client that had lost the channel, or one that reloaded straight back in.
   */
  const standDown = useCallback(() => {
    if (endingRef.current) return;
    sendSignalRef.current({ type: "leave", from: myIdRef.current });
    endingRef.current = true;
    teardownCallRef.current();
    setCallPhase((prev) => nextPhase(prev, "remote_end"));
    // A guest has no /meetings to go back to — it is inside the signed-in app,
    // so pushing them there answers "the host removed you" with a login form.
    if (isGuestRef.current) { setShowGuestUpsell(true); return; }
    router.push("/meetings");
  }, [router]);

  const standDownRef = useRef(standDown);
  useEffect(() => { standDownRef.current = standDown; }, [standDown]);

  /** Tear down this client's own connection to a peer, and forget them. */
  const dropPeer = useCallback((peerId: string) => {
    peersRef.current.get(peerId)?.close(); peersRef.current.delete(peerId);
    // Locally, not on the strength of a `leave` coming back: a removed client
    // that has already gone, crashed, or lost the channel sends nothing, and
    // its senders, buffered candidates and pending audit would then sit in
    // these maps for the rest of the call.
    forgetPeerState(peerId);
    setPeers((prev) => { if (!prev.has(peerId)) return prev; const next = new Map(prev); next.delete(peerId); return next; });
    setPeerStatus((prev) => { if (!prev.has(peerId)) return prev; const next = new Map(prev); next.delete(peerId); return next; });
    setPeerVideo((prev) => { if (!prev.has(peerId)) return prev; const next = new Map(prev); next.delete(peerId); return next; });
    setRaisedHands((prev) => { if (!prev.has(peerId)) return prev; const next = new Set(prev); next.delete(peerId); return next; });
    // One fewer upload to pay for.
    applySendCapsRef.current();
  }, [forgetPeerState]);

  /**
   * Ask the server which of the people in this room are no longer supposed to
   * be here, and drop them.
   *
   * The nudge that triggers this carries no names, and deliberately: anyone
   * holding the room code can publish on a broadcast channel, so a message
   * saying "drop peer X" would be a way to eject anybody from any meeting whose
   * link had been forwarded once. See removal-channel.ts.
   *
   * So the question is asked here, naming the SIGNALLING IDS this client can
   * see, and answered by the server — which resolves each one to the person the
   * knock recorded under it. Our own id goes in the same request: the host's
   * broadcast is the fast path for standing down, and this is what covers the
   * client that never received it, or that ignored it.
   */
  const checkRemovals = useCallback(async () => {
    const mine = myIdRef.current;
    const peerIds = [...peersRef.current.keys()];
    const signalIds = [...peerIds, mine];

    let removed: string[] = [];
    try {
      const res = await fetch(`/api/meetings/public/${roomCode}/removed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signalIds }),
        cache: "no-store",
      });
      if (!res.ok) return;
      removed = ((await res.json()) as { removed?: string[] }).removed ?? [];
    } catch (err) {
      // A removal is enforced at the door as well, so losing this costs the
      // room the immediate teardown rather than the rule.
      console.warn("[meeting] could not check removals", err);
      return;
    }
    if (removed.length === 0) return;

    const gone = new Set(removed);
    for (const peerId of peerIds) {
      if (gone.has(peerId)) dropPeer(peerId);
    }
    // Last, so the room is tidy before this client goes.
    if (gone.has(mine)) standDownRef.current();
  }, [roomCode, dropPeer]);

  const checkRemovalsRef = useRef(checkRemovals);
  useEffect(() => { checkRemovalsRef.current = checkRemovals; }, [checkRemovals]);

  /**
   * Listen for removals while we are in the call.
   *
   * Every participant, not just the host: the defect this closes is that a
   * removed person stayed connected to everybody except the person who removed
   * them. One channel per room, because this nudge names nobody and so has
   * nothing to leak.
   */
  useEffect(() => {
    if (!sessionLive || !roomCode) return;
    const channel = supabase
      .channel(removalChannelName(roomCode))
      .on("broadcast", { event: REMOVAL_NUDGE }, () => {
        void checkRemovalsRef.current();
        // The host's own list is not driven by Realtime — the table is not in
        // the publication — so the nudge it just caused is what refreshes it.
        if (isHostRef.current) void loadRemovalsRef.current();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [sessionLive, roomCode, supabase]);

  /**
   * Remove somebody from the meeting.
   *
   * This used to be a broadcast and a local close, and it removed them from
   * exactly one screen. The `kick` message is acted on only by its target, and
   * only the HOST closed a connection — so every other participant kept a live
   * peer connection to the person, whose camera and microphone carried on
   * reaching all of them. Meanwhile nothing was written anywhere, so a reload
   * put them back: an invite-link guest's key is in localStorage against the
   * room code and their admission row still said `admitted`, and a signed-in
   * teammate never went near the waiting room at all.
   *
   * Three things happen now, in this order and for three different reasons.
   * The broadcast goes first, because it is the fastest way for the removed
   * client to stand itself down. The local teardown follows, because the host
   * should not wait on a round trip to stop seeing them. And the route makes it
   * a fact: it resolves the tile to whoever the knock recorded under that
   * signalling id, records the removal, denies their admission, and nudges the
   * room so every other participant drops them too.
   *
   * Only the SIGNALLING ID is sent. The host's screen has no durable identity
   * for a participant, and an earlier version closed that gap by having peers
   * announce their own — which meant a participant could announce somebody
   * else's and have the host ban them by clicking Remove on the wrong tile.
   * The server resolves it instead, from a row the server itself wrote.
   */
  const kickPeer = useCallback(async (peerId: string) => {
    sendSignal({ type: "kick", from: myIdRef.current, target: peerId });
    dropPeer(peerId);

    if (!meetingIdRef.current) return;

    // Awaited, and its failure surfaced. The broadcast above has already put
    // them out of this call, but whether they can come BACK is decided by this
    // request alone — and a host who saw the tile vanish has every reason to
    // believe it is settled. A removal that silently failed to record is the
    // defect this whole path replaced, so it must not be reintroduced as a
    // console warning.
    try {
      const res = await fetch(`/api/meetings/${meetingIdRef.current}/removals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signalId: peerId }),
      });
      if (res.ok) {
        void loadRemovalsRef.current();
        return;
      }
      console.warn("[meeting] removal not recorded", res.status);
    } catch (err) {
      console.warn("[meeting] removal not recorded", err);
    }
    setRemovalNotice(
      "They have been dropped from this call, but the removal could not be saved — they may be able to rejoin.",
    );
  }, [sendSignal, dropPeer]);

  // Admit / deny write the decision through the host-only admissions route
  // (service-role). The waiting guest's poll then picks up the new status and
  // enters (or leaves). We optimistically drop the row locally so the press feels
  // immediate.
  //
  // The optimism needs an undo. Realtime was left to "reconcile the authoritative
  // list", but it only fires when a row actually changes — and the case worth
  // reconciling is the one where nothing changed, because the write failed. The
  // guest then vanished from the host's panel while still standing outside, and
  // the host had every reason to think they had let them in. So a failed decision
  // re-reads the list and puts them back, where they can be admitted again.
  /**
   * Send a decision, and hold the panel to it until the table catches up.
   *
   * `ids` is what was removed from the screen optimistically. Remembering it
   * stops the coalesced re-read and the Realtime events putting those people
   * back while the POST is in flight; forgetting it on failure is what lets the
   * re-read below actually restore them, which is the whole point of that
   * re-read and would otherwise be silently swallowed.
   */
  const decideAdmission = useCallback(async (body: Record<string, unknown>, ids: readonly string[]) => {
    if (!meetingId) return;
    decidedRef.current = rememberDecided(decidedRef.current, ids, Date.now());
    let ok = false;
    try {
      const res = await fetch(`/api/meetings/${meetingId}/admissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ok = res.ok;
      if (!ok) console.warn("[meeting] admission decision rejected", res.status);
    } catch (e) { console.warn("[meeting] admission decision failed", e); }
    if (!ok) {
      decidedRef.current = forgetDecided(decidedRef.current, ids);
      await loadWaiting();
    }
  }, [meetingId, loadWaiting]);

  const admitPeer = useCallback((admissionId: string) => {
    setWaitingPeers((prev) => prev.filter((w) => w.id !== admissionId));
    void decideAdmission({ decision: "admit", admissionId }, [admissionId]);
  }, [decideAdmission]);

  const denyPeer = useCallback((admissionId: string) => {
    setWaitingPeers((prev) => prev.filter((w) => w.id !== admissionId));
    void decideAdmission({ decision: "deny", admissionId }, [admissionId]);
  }, [decideAdmission]);

  const admitAll = useCallback(() => {
    // Every id on the panel right now: "all" is a decision about the people the
    // host can see, and those are the ones the table must not hand back.
    const ids = waitingPeersRef.current.map((w) => w.id);
    setWaitingPeers([]);
    void decideAdmission({ decision: "admit", all: true }, ids);
  }, [decideAdmission]);

  /**
   * Release everything the call holds: peers, the signaling channel, the
   * recognizer, and the camera and microphone.
   *
   * One function because there are four ways out of a room — leave, end, the
   * host ending it for everyone, and navigating away — and each used to repeat
   * this list slightly differently. It is idempotent, so a second call (a retry,
   * or unmount right after a leave) is harmless.
   *
   * Leaving the "live" phase matters as much as stopping the tracks. Every
   * interval here is gated on it, and without that they kept running against a
   * dead call: voice metering eight times a second on stopped tracks, getStats
   * on closed peer connections, and a notes request every fifteen seconds. On
   * the guest upsell screen, which never navigates away, they ran forever.
   */
  const teardownCall = useCallback(() => {
    clearWaitingTimers();
    // Every way out of a call comes through here — the leave button, the host
    // ending it, being denied — so this is the one place departure has to be
    // written for presence to ever go back down.
    recordDeparture();
    // Clearing the timers stopped the poll but left `waitingForAdmit` set, and
    // the waiting screen is rendered ahead of every exit screen below — so a
    // guest who pressed Cancel got the timers torn down and then went on staring
    // at "Waiting for host to admit you…" over a dead camera, with a Cancel
    // button that had already fired once and was now guarded shut. Leaving the
    // waiting room is part of tearing the call down.
    setWaitingForAdmit(false);
    setWaitingTimedOut(false);
    peersRef.current.forEach((pc) => { try { pc.close(); } catch { /* already closed */ } });
    peersRef.current.forEach((_pc, id) => forgetPeerState(id));
    peersRef.current.clear();
    pendingIceRef.current.clear();
    recoveryTimerRef.current.forEach((t) => clearTimeout(t));
    recoveryTimerRef.current.clear();
    // Belt and braces alongside forgetPeerState above: a pending audit that
    // fired after teardown would report on a call that no longer exists.
    inboundAuditRef.current.forEach((t) => clearTimeout(t));
    inboundAuditRef.current.clear();
    // The held-demotion re-check has no peers left to re-evaluate, and would
    // signal into a channel that is about to be unsubscribed.
    if (demoteTimerRef.current) { clearTimeout(demoteTimerRef.current); demoteTimerRef.current = null; }
    try { channelRef.current?.unsubscribe(); } catch { /* already gone */ }
    channelRef.current = null;
    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; recognitionRef.current.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
    tornDownRef.current = true;
    maskRef.current?.destroy();
    maskRef.current = null;
    try { rawCameraTrackRef.current?.stop(); } catch { /* already stopped */ }
    rawCameraTrackRef.current = null;
    setRawCameraTrack(null);
    localStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    previewStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    // Not `setReady(false)`: `ready` also decides whether the pre-join screen is
    // showing, and clearing it would drop someone into the green room while their
    // report was still generating. The phase is what the intervals watch.
    setCallPhase((prev) => (prev === "live" ? "left" : prev));

    // The link verdict belongs to the call that was measured, not to the next
    // one. Left standing, a member who left on a bad connection and rejoined on
    // a good one started the new call in audio-only and had to earn their way
    // back out of a judgement about a network they were no longer on.
    linkRef.current = INITIAL_LINK;
    bwModeRef.current = "normal";
    setBwMode("normal");

    setLocalStream(null);
    setPeers(new Map());
    setPeerStatus(new Map());
    setPeerVideo(new Map());
    speakingStore.publish(new Set());
  }, [clearWaitingTimers, recordDeparture, forgetPeerState, speakingStore]);

  const teardownCallRef = useRef(teardownCall);
  useEffect(() => { teardownCallRef.current = teardownCall; }, [teardownCall]);

  // Leaving the page is leaving the meeting. Nothing tore the call down on
  // unmount, so a guest who navigated away from the waiting screen — browser
  // back, a link, anything that is not the Cancel button — left the admission
  // session running behind them: polling on a timer nobody would ever stop, and
  // now holding a Realtime subscription too. Empty deps and the ref on purpose:
  // depending on `teardownCall` would re-run this whenever its identity changed
  // and tear down a live call mid-meeting.
  useEffect(() => () => { teardownCallRef.current(); }, []);

  // Closing the tab is a way of leaving a meeting, and by far the most common
  // one. `pagehide` rather than `beforeunload`: it fires on mobile Safari's
  // back-forward cache path too, where beforeunload does not.
  useEffect(() => {
    const onHide = () => recordDeparture();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [recordDeparture]);

  // Closing the tab is also by far the most common way of giving up on a WAIT,
  // and it left the host holding a name that was never coming — `recordDeparture`
  // above covers people who got in, not people still outside. Only while
  // actually waiting: a knock that has been decided is not ours to withdraw.
  useEffect(() => {
    // Every state where something is still asking on this guest's behalf, which
    // is wider than `waitingForAdmit`: a guest refused on a RE-knock still has
    // the row their first knock inserted, and withdrawing when there is nothing
    // to withdraw costs one request nobody is waiting on.
    if (!isAdmissionLive(admissionUi)) return;
    const onHide = () => withdrawKnock({ keepalive: true });
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [admissionUi, withdrawKnock]);

  const leaveMeeting = useCallback(async () => {
    // The ref, not the state, is the guard: a second click lands before React has
    // committed the phase change from the first.
    if (endingRef.current || !canExit(callPhaseRef.current)) return;
    endingRef.current = true;
    callPhaseRef.current = nextPhase(callPhaseRef.current, "leave");
    sendSignal({ type: "leave", from: myIdRef.current });
    teardownCall();

    // Drain, not flush. This is the last chance these words have, and it was
    // being handed to the flush effect's cleanup — ONE batch of at most
    // MAX_BATCH lines, fired off with `keepalive` and never checked. A
    // participant whose writes had been failing reached Leave holding hundreds
    // of unsaved lines, and fifty of them were saved.
    //
    // `endMeeting` has always drained. But only a host sees End: every guest
    // and every non-host leaves through here, which is to say most people in
    // most meetings left by the path that saved one batch. Their words are the
    // only copy of what they said — under the ownership rule in
    // transcript-buffer, nobody else is saving them.
    //
    // Awaited before navigating so the requests are not racing an unmount.
    await drainTranscript();

    if (isGuest) { setShowGuestUpsell(true); return; }
    router.push("/meetings");
  }, [sendSignal, teardownCall, drainTranscript, router, isGuest]);

  const endMeeting = useCallback(async () => {
    // A second press while the report is generating would tear down an already
    // dead call and post a second report — another stored report row, and another
    // batch of auto-created tasks for the same meeting.
    if (endingRef.current || !canExit(callPhaseRef.current)) return;
    endingRef.current = true;
    callPhaseRef.current = nextPhase(callPhaseRef.current, "end");
    setCallPhase(callPhaseRef.current);
    sendSignal({ type: "end", from: myIdRef.current });
    teardownCall();

    if (!meetingId) { router.push("/meetings"); return; }

    // Save what has not been saved BEFORE asking for the report, so the two
    // records agree and so the rows survive whatever happens next. A report
    // request can fail, time out, or be abandoned by a host who closes the tab
    // while it runs; the transcript should not depend on any of that.
    await drainTranscript();

    const fullText = transcriptRef.current.filter((l) => l.final).map(formatTranscriptLine).join("\n");
    // The model was told "Meeting: Untitled" and "Participants: Unknown" on
    // every meeting ever ended from this room, because neither was sent. Its
    // system prompt asks it to assign action items to named people and to draft
    // a follow-up email, and it was doing both without knowing whose meeting it
    // was or who had been in it.
    const participants = speakerNames(
      transcriptRef.current,
      [localNameRef.current, ...[...peersDataRef.current.values()].map((p) => p.displayName)],
    );
    try {
      const res = await fetch("/api/meetings/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId,
          title: meetingTitleRef.current,
          participants,
          transcript: fullText,
          // Read once, here, from the spans — not a counter that has been
          // accumulating since the call began. This number IS the meeting's
          // recorded length, and a tick-counter version of it was short by
          // however late every one of its callbacks had been.
          duration: elapsedSeconds(elapsedRef.current, monotonicNow()),
        }),
      });
      if (res.ok) { router.push(`/meetings/${roomCode}/report`); return; }
      // A failed report used to fall through to the meetings list, which reads as
      // the meeting simply vanishing — no report, no explanation.
      console.warn("[meeting] report failed", res.status);
    } catch (e) { console.warn("[meeting] report error", e); }

    // Back to a state the retry button can act from.
    endingRef.current = false;
    callPhaseRef.current = nextPhase(callPhaseRef.current, "report_failed");
    setCallPhase(callPhaseRef.current);
  }, [sendSignal, teardownCall, meetingId, roomCode, router, drainTranscript]);

  const endForAll = useCallback(async () => {
    await endMeeting();
  }, [endMeeting]);

  /** Give up on the report and leave. The transcript rows are already saved. */
  // Collapsing animates, so the panel has to outlive the click that closed it —
  // an unmounted element cannot slide anywhere. `copilotOpen` drives the
  // transition; `copilotMounted` trails it, staying true for the length of the
  // exit and then going false so the panel genuinely leaves the tree. Keeping it
  // mounted-but-hidden would leave the whole transcript re-rendering behind a
  // panel nobody can see, which is the opposite of collapsing it.
  const collapseCopilot = useCallback(() => {
    chatOpenRef.current = false;
    setCopilotOpen(false);
    if (copilotUnmountRef.current) clearTimeout(copilotUnmountRef.current);
    copilotUnmountRef.current = setTimeout(() => setCopilotMounted(false), COPILOT_SLIDE_MS);
  }, []);

  const expandCopilot = useCallback(() => {
    if (copilotUnmountRef.current) { clearTimeout(copilotUnmountRef.current); copilotUnmountRef.current = null; }
    setCopilotMounted(true);
    // Mount off-screen first, then animate in on the next frame. Setting both in
    // one commit paints the panel already open and the entry slide never runs.
    requestAnimationFrame(() => requestAnimationFrame(() => setCopilotOpen(true)));
  }, []);

  const abandonReport = useCallback(() => {
    endingRef.current = true;
    callPhaseRef.current = nextPhase(callPhaseRef.current, "abandon");
    setCallPhase(callPhaseRef.current);
    router.push("/meetings");
  }, [router]);

  // ── Exit screens ────────────────────────────────────────────────────────
  //
  // These come first deliberately. Both used to sit below the waiting-room and
  // pre-join branches, which return unconditionally on the same state — so a
  // guest who cancelled kept seeing the waiting screen, and one who left after
  // being in the room was dropped back into the green room instead of the
  // thank-you. An exit outranks whatever screen was showing when it happened.

  // Stable across renders, always calling the latest closures — which is what
  // lets the memoized ControlBar skip the room's frequent re-renders (someone
  // starts talking, a chat line lands) without ever acting on stale state.
  const controlBarHandlers = useStableHandlers({
    onToggleRecording: () => {
      if (recorder.state === "recording") recorder.stop();
      else void recorder.start();
    },
    onToggleMic: toggleMic,
    onToggleCam: toggleCam,
    onToggleScreen: () => void toggleScreen(),
    onToggleCopilot: () => (copilotOpen ? collapseCopilot() : expandCopilot()),
    onLeave: () => void leaveMeeting(),
    onEndForAll: () => void endForAll(),
    onOpenBackgrounds: () => setBgPickerOpen((v) => !v),
    onSwitchMic: switchMic,
    onSwitchCam: switchCam,
    onSwitchSpeaker: switchSpeaker,
    onRaiseHand: toggleRaiseHand,
    onReaction: sendReaction,
    onMuteAll: muteAll,
    onToggleLayout: () => setLayout((v) => v === "grid" ? "speaker" : "grid"),
    onFlipCamera: () => void flipCamera(),
  });

  /**
   * Who is in the call, as the panels want them.
   *
   * Memoized for its IDENTITY rather than for the cost of building it — a
   * handful of objects is nothing. It is handed to the copilot sidebar, which
   * memoizes work on it, and a fresh array every render makes every such memo a
   * comment: it recomputes each time while reading as though it does not. The
   * room re-renders several times a second whenever anybody is talking, so that
   * is the common case, not the rare one.
   *
   * Declared HERE, above the early returns below, because these are hooks: the
   * active-meeting section further down is past a `return`, and a hook after a
   * conditional return does not run in the same order every render.
   */
  const allPeers = useMemo(() => [...peers.values()] as Peer[], [peers]);
  const participantList = useMemo(() => [
    { id: LOCAL_SPEAKER_ID, displayName: localName, micOn, isLocal: true },
    ...allPeers.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      // A peer who has not announced yet is assumed live: everyone joins
      // unmuted, and showing a real speaker as muted is the worse error.
      micOn: peerMicOn.get(p.id) ?? true,
      isLocal: false,
    })),
  ], [allPeers, localName, micOn, peerMicOn]);

  if (deniedByHost) {
    return (
      <BodyPortal>
        <NotAdmittedScreen
          meetingTitle={meetingTitle}
          roomCode={roomCode}
          onLeave={() => router.push("/")}
        />
      </BodyPortal>
    );
  }

  if (showGuestUpsell) {
    return (
      <BodyPortal>
        <GuestThanksScreen onLeave={() => router.push("/")} />
      </BodyPortal>
    );
  }

  // ── Pre-join screen ───────────────────────────────────────────────────────

  if (!ready) {
    return (
      <MeetingGreenRoom
        roomCode={roomCode}
        isHost={isHost}
        joining={joining}
        admission={admissionUi}
        onCancelAdmission={cancelAdmission}
        displayName={displayName}
        onDisplayNameChange={setDisplayName}
        meetingTitle={meetingTitle}
        onJoin={(choice) => void joinMeeting(choice)}
        onPreviewStream={(s, release) => {
          // Nothing the green room says after the call has taken its tracks:
          // they are on the wire now, and filing them as a preview again would
          // hand the next teardown a live microphone to stop.
          if (adoptedPreviewRef.current) return;
          previewStreamRef.current = s;
          releasePreviewRef.current = release;
        }}
      />
    );
  }

  // ── Active meeting ────────────────────────────────────────────────────────

  // The call screen's code, almost always here by now: it was fetched while the
  // member sat in the green room. If it is not, say so in place — the call
  // itself is already running underneath and must not be torn down over it.
  if (!callParts) {
    return (
      <BodyPortal>
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[var(--surface-0)] text-sm text-[var(--fg-muted)]">
          {callPartsFailed ? (
            <>
              <p>Couldn&apos;t load the call screen. Check your connection.</p>
              <button
                type="button"
                onClick={() => { setCallPartsFailed(false); setCallPartsRetry((n) => n + 1); }}
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--fg-primary)]"
              >
                Retry
              </button>
            </>
          ) : (
            <p>Joining…</p>
          )}
        </div>
      </BodyPortal>
    );
  }
  const { VideoTile, PeerAudio, CopilotSidebar, ControlBar, ReactionTicker } = callParts;
  const sameRoomNames = allPeers.filter((p) => sameRoomPeers.has(p.id)).map((p) => p.displayName);

  const totalCount = 1 + allPeers.length;
  const gridClass = totalCount === 1 ? "grid-cols-1" : totalCount === 2 ? "grid-cols-2" : totalCount <= 4 ? "grid-cols-2" : "grid-cols-3";

  // The others' hands, oldest first — the order a chair would take them in.
  const handsUpPeople = raisedBy(raisedHands, participantList, LOCAL_SPEAKER_ID);
  const handsUpNote = handsUpLabel(handsUpPeople);

  // Reactions with a name attached, oldest first — the same shape raisedBy
  // gives for hands, and for the same reason: the tile is not a reliable place
  // to have seen it.
  const liveReactions = activeReactions(reactions, participantList);

  const getReaction = (id: string) => reactions[id]?.emoji ?? "";
  // Assume a peer's camera is on until they say otherwise: the announcement
  // lands a moment after they appear, and a tile that starts on "Camera off" and
  // corrects itself reads worse than one that starts blank.
  const videoOf = (id: string) => peerVideo.get(id) ?? { camOn: true, paused: false, sharing: false };
  const statusOf = (id: string) => peerStatus.get(id) ?? "connecting";
  const isHandRaised = (id: string) => id === "local" ? handRaised : raisedHands.has(id);

  // Speaker view helpers
  const speakerTileId = stageFocus ?? "local";
  const speakerIsLocal = speakerTileId === "local";
  const speakerPeer = speakerIsLocal ? null : allPeers.find((p) => p.id === speakerTileId);
  const stripItems: { id: string; displayName: string; stream: MediaStream | null; isLocal: boolean }[] = speakerIsLocal
    ? allPeers.map((p) => ({ id: p.id, displayName: p.displayName, stream: p.stream, isLocal: false }))
    : [{ id: "local", displayName: localName, stream: localStream, isLocal: true }, ...allPeers.filter((p) => p.id !== speakerTileId).map((p) => ({ id: p.id, displayName: p.displayName, stream: p.stream, isLocal: false }))];

  return (
    <BodyPortal>
    {/* The tiles and the sidebar's rows read who is talking from here rather
        than from props, which is what keeps a voice out of this component's
        render. See createSpeakingStore. */}
    <SpeakingProvider value={speakingStore}>
    <div className="fixed inset-0 z-50 bg-[var(--surface-0)] flex flex-col">
      {/* `relative` so the mobile copilot sheet fills the video area rather than
          the viewport — see the sheet's own note below. */}
      <div className="relative flex flex-1 overflow-hidden min-h-0">
        {/* Video area. `relative` anchors ReactionTicker to the stage: over the
            viewport it would sit on top of the control bar, which is the mistake
            the mobile copilot sheet already made once. */}
        <div className="relative flex-1 flex flex-col overflow-hidden bg-[var(--surface-0)] min-w-0">
          <ReactionTicker entries={liveReactions} />
          {/* Not being seen or heard, which is not the same as being muted.
              Derived from the devices and so NOT dismissible: while it is true
              it stays, because the alternative is what shipped — a guest who
              believed they were live and a room that had been told so. */}
          {participation && (
            <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border-b border-red-500/40 shrink-0">
              <span className="text-red-500 mt-0.5 shrink-0">⚠</span>
              <p className="flex-1 text-sm text-red-600 dark:text-red-400">{participation.text}</p>
              <button
                onClick={() => {
                  // Both, when both are gone: one press should fix what one
                  // address-bar decision just allowed.
                  //
                  // Logged, not swallowed. `startCamera` is try/finally with no
                  // catch, so a rejection out of it escapes a bare `void` as an
                  // unhandled rejection -- but an EMPTY catch is worse, because
                  // the banner stays up either way and the console was the only
                  // place a broken retry showed at all.
                  const failed = (what: string) => (err: unknown) =>
                    console.warn(`[meeting] ${what} retry failed`, err);
                  if (participation.reason !== "no-camera") {
                    void reacquireMicRef.current().catch(failed("microphone"));
                  }
                  if (participation.reason !== "no-microphone") {
                    void startCameraRef.current().catch(failed("camera"));
                  }
                }}
                className="shrink-0 rounded-full border border-red-500/50 px-3 py-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors">
                Retry
              </button>
            </div>
          )}
          {/* Media permission warning. Stood down while the banner above is up:
              they would otherwise say much the same thing twice, and only one of
              them can be acted on. */}
          {mediaError && !participation && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border-b border-amber-500/30 shrink-0">
              <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
              <p className="flex-1 text-sm text-amber-600 dark:text-amber-400">{mediaError}</p>
              <button onClick={() => setMediaError(null)} className="shrink-0 text-amber-500 hover:text-amber-600 text-xs font-medium underline">Dismiss</button>
            </div>
          )}
          {/* Echo. Its own banner, not `mediaError`: see `echoNotice`. */}
          {echoNotice && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border-b border-amber-500/30 shrink-0">
              <span className="text-amber-500 mt-0.5 shrink-0">🔊</span>
              <p className="flex-1 text-sm text-amber-600 dark:text-amber-400">{echoNotice}</p>
              <button onClick={() => setEchoNotice(null)} className="shrink-0 text-amber-500 hover:text-amber-600 text-xs font-medium underline">Dismiss</button>
            </div>
          )}
          {/* Same room. Not a warning: the echo has already been dealt with,
              and this says how, and how to take it back. */}
          {sameRoomNames.length > 0 && (
            <div role="status" className="flex items-start gap-3 px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--line)] shrink-0">
              <span className="mt-0.5 shrink-0">🔇</span>
              <p className="flex-1 text-sm text-[var(--fg-secondary)]">{voiceReturnNotice(sameRoomNames)}</p>
              <button
                onClick={() => {
                  sameRoomPeers.forEach((id) => keepAudibleRef.current.add(id));
                  setSameRoomPeers(new Set());
                }}
                className="shrink-0 text-xs font-medium text-[var(--fg-muted)] hover:text-[var(--fg-primary)] underline transition-colors"
              >
                Unmute
              </button>
            </div>
          )}
          {/* Guest upsell banner */}
          {isGuest && (
            <div className="flex items-center gap-3 px-4 py-2 bg-gold-400/10 border-b border-gold-400/20 shrink-0">
              <span className="text-[var(--gold-400)] text-xs shrink-0">✦</span>
              <p className="flex-1 text-xs text-[var(--fg-secondary)]">You&apos;re joining as a guest. Request access for AI transcription, notes, and action items.</p>
              <a href="/request-access" className="shrink-0 text-xs font-semibold text-[var(--gold-400)] hover:text-[var(--gold-500)] whitespace-nowrap transition-colors">Request access →</a>
            </div>
          )}
          {/* The notice, distinct from the badge in the control bar. Everyone in
              the room sees this, in the same words, the moment a recording
              starts — a recorded conversation that only the recorder knew about
              is the thing several US states actually prohibit. It withdraws
              itself; the badge is what carries the fact for the rest of the
              call. */}
          {recordingNoticeOpen && recordingBanner && (
            <div
              role="status"
              className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-[var(--status-danger)]/30 shrink-0"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--status-danger)] animate-pulse shrink-0" />
              <p className="flex-1 text-xs font-medium text-[var(--fg-primary)]">
                {recordingNotice("recording", recordingBanner.by)}
              </p>
              <button
                onClick={() => setRecordingNoticeOpen(false)}
                className="shrink-0 text-xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
          {/* A removal that could not be written down. The person IS out of the
              call — the broadcast and the teardown both ran — but they may be
              able to come back, and a host who watched the tile vanish would
              otherwise have no way to know that. */}
          {removalNotice && (
            <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-[var(--status-warning)]/10 border-b border-status-warning/30 shrink-0">
              <p className="flex-1 text-xs text-[var(--fg-secondary)]">{removalNotice}</p>
              <button
                onClick={() => setRemovalNotice(null)}
                className="shrink-0 text-xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
          {recorder.error && (
            <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-red-500/10 border-b border-[var(--status-danger)]/30 shrink-0">
              <p className="flex-1 text-xs text-[var(--fg-secondary)]">{recorder.error}</p>
            </div>
          )}
          {/* A recording that worked but lost parts. Not an alert — the file
              plays — and dismissible, because it describes something finished
              rather than something to act on. */}
          {recorder.notice && (
            <div role="status" className="flex items-center gap-3 px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--line)] shrink-0">
              <p className="flex-1 text-xs text-[var(--fg-secondary)]">{recorder.notice}</p>
              <button
                onClick={recorder.dismissNotice}
                className="text-xs font-medium text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
          {/* Everyone's voice, once each, independent of layout. The tiles
              below are muted pictures; see PeerAudio. */}
          {allPeers.map((peer: Peer) => (
            <PeerAudio key={peer.id} stream={peer.stream} audioTrack={audioTrackOf(peer.stream)} silenced={sameRoomPeers.has(peer.id)} />
          ))}
          {stageLayout === "grid" ? (
            <div className={`flex-1 grid ${gridClass} gap-3 p-4 content-center`}>
              <VideoTile stream={localStream} videoTrack={videoTrackOf(localStream)} label={localName} isLocal showingScreenShare={shareOn} handRaised={handRaised} reaction={getReaction("local")} micOn={micOn} watchId={LOCAL_SPEAKER_ID} camOn={camOn} videoPaused={bwMode === "audio-only"} />
              {allPeers.map((peer: Peer) => (
                <VideoTile key={peer.id} stream={peer.stream} videoTrack={videoTrackOf(peer.stream)} label={peer.displayName} handRaised={raisedHands.has(peer.id)} reaction={getReaction(peer.id)} micOn={peerMicOn.get(peer.id) ?? true} watchId={peer.id} camOn={videoOf(peer.id).camOn} videoPaused={videoOf(peer.id).paused} status={statusOf(peer.id)} />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-2 p-4 overflow-hidden min-h-0">
              {/* Main speaker tile */}
              <div className="flex-1 min-h-0">
                {speakerIsLocal ? (
                  <VideoTile stream={localStream} videoTrack={videoTrackOf(localStream)} label={localName} isLocal showingScreenShare={shareOn} handRaised={handRaised} reaction={getReaction("local")} micOn={micOn} watchId={LOCAL_SPEAKER_ID} camOn={camOn} videoPaused={bwMode === "audio-only"} large />
                ) : speakerPeer ? (
                  <VideoTile stream={speakerPeer.stream} videoTrack={videoTrackOf(speakerPeer.stream)} label={speakerPeer.displayName} handRaised={isHandRaised(speakerPeer.id)} reaction={getReaction(speakerPeer.id)} micOn={peerMicOn.get(speakerPeer.id) ?? true} watchId={speakerPeer.id} camOn={videoOf(speakerPeer.id).camOn} videoPaused={videoOf(speakerPeer.id).paused} status={statusOf(speakerPeer.id)} large />
                ) : (
                  <VideoTile stream={localStream} videoTrack={videoTrackOf(localStream)} label={localName} isLocal showingScreenShare={shareOn} handRaised={handRaised} reaction={getReaction("local")} micOn={micOn} watchId={LOCAL_SPEAKER_ID} camOn={camOn} videoPaused={bwMode === "audio-only"} large />
                )}
              </div>
              {/* Thumbnail strip */}
              {stripItems.length > 0 && (
                <div className="flex gap-2 h-24 shrink-0 overflow-x-auto">
                  {stripItems.map((item) => (
                    <div key={item.id} className="h-full aspect-video shrink-0">
                      <VideoTile stream={item.stream} videoTrack={videoTrackOf(item.stream)} label={item.displayName} isLocal={item.isLocal} showingScreenShare={item.isLocal && shareOn} handRaised={isHandRaised(item.id)} reaction={getReaction(item.id)} micOn={item.isLocal ? micOn : (peerMicOn.get(item.id) ?? true)} watchId={item.id} camOn={item.isLocal ? camOn : videoOf(item.id).camOn} videoPaused={item.isLocal ? bwMode === "audio-only" : videoOf(item.id).paused} status={item.isLocal ? "live" : statusOf(item.id)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Copilot sidebar — side panel on desktop, overlay sheet on mobile.
            The mobile sheet is absolute within the video area, not fixed to the
            viewport: as a viewport overlay it painted over the control bar, which
            holds the only button that could dismiss it. Opening the copilot on a
            phone therefore left no way back to mute, leave or end the call.

            Collapsing narrows the column to zero on desktop, so the video grows
            into the space as the panel goes rather than snapping wider after it;
            on mobile the sheet slides off to the right. Either way it leaves
            nothing behind — the control-bar Copilot button brings it back. */}
        {copilotMounted && (
          <div
            aria-hidden={!copilotOpen}
            className={`
              flex flex-col overflow-hidden bg-[var(--surface-1)]
              absolute inset-0 z-30 transition-transform duration-200 ease-out
              motion-reduce:transition-none
              ${copilotOpen ? "translate-x-0" : "translate-x-full pointer-events-none"}
              sm:relative sm:inset-auto sm:z-auto sm:bg-transparent sm:translate-x-0
              sm:shrink-0 sm:transition-[width] sm:duration-200 sm:ease-out
              ${copilotOpen ? "sm:w-80" : "sm:w-0"}
            `}
          >
            {/* Fixed width inside the animating column: without it the panel's
                text reflows on every frame of the slide. */}
            <div className="flex flex-col h-full w-full sm:w-80 overflow-hidden">
            {/* Reset on the roster rather than on a notes payload: the panel no
                longer renders model output, and the roster is the thing whose
                change is worth giving a failed render another try. */}
            <CopilotErrorBoundary resetKey={participantList.length}>
            <CopilotSidebar
              srStatus={srStatus} participants={participantList} roomCode={roomCode} meetingTitle={meetingTitle}
              chatMessages={chatMessages} chatUnread={chatUnread}
              onSendChat={(t) => void sendChat(t)} onRetryChat={(id) => void retryChat(id)} isHost={isHost}
              raisedHands={raisedHands} onKick={(id) => void kickPeer(id)} onAdmit={admitPeer} onDeny={denyPeer} onAdmitAll={admitAll}
              waitingPeers={livePeers}
              removedPeople={removedPeople} onAllowBack={(s) => void allowBack(s)}
              onChatVisibility={handleChatVisibility}
              onCollapse={collapseCopilot}
              meetingId={meetingId}
              // Signed in, not a guest. A guest has no firm behind them to
              // share from; whether a signed-in viewer is a MEMBER of the
              // host's firm is not something the room can tell from attendance,
              // so the route decides and the panel reports the refusal.
              canShareDocs={!isGuest}
            />
            </CopilotErrorBoundary>
            </div>
          </div>
        )}
      </div>

      {isHost && (
        <WaitingRoomBar
          waitingPeers={livePeers}
          onAdmit={admitPeer}
          onDeny={denyPeer}
          onAdmitAll={admitAll}
        />
      )}

      {/* Above the mobile copilot sheet: mute, leave and end must never be
          covered by a panel. */}
      <div className="relative z-40 shrink-0">
      <ControlBar
        micOn={micOn} camOn={camOn} shareOn={shareOn} shareStarting={shareStarting} copilotOpen={copilotOpen}
        micTitle={micButtonTitle(micStanding)} camTitle={camButtonTitle(camStanding)}
        isHost={isHost} handRaised={handRaised} layout={layout} chatUnread={chatUnread}
        handsUp={handsUpPeople.length} handsUpNote={handsUpNote}
        waitingCount={isHost ? livePeers.length : 0} elapsed={elapsedRef}
        roomCode={roomCode} bwMode={bwMode} layoutForced={layoutIsForced(layout, sharerId)}
        recordingState={recordingBanner?.state ?? "idle"}
        recordingBy={recordingBanner?.by ?? ""}
        recordingStartedAt={recorder.startedAt}
        leaving={isAwaitingReport(callPhase)}
        backgroundActive={bgEffect.kind !== "none"}
        backgroundBtnRef={bgBtnRef}
        activeMicId={selectedMicId} activeCamId={selectedCamId} camStarting={camStarting}
        {...controlBarHandlers}
      />
      </div>

      {/* Background picker, anchored to its control */}
      <FloatingMenu open={bgPickerOpen} anchorRef={bgBtnRef} onClose={() => setBgPickerOpen(false)} minWidth={330}>
        <div className="w-[330px] max-w-[86vw] p-1">
          <p className="px-1 pb-2 text-xs font-medium text-[var(--fg-secondary)]">Background</p>
          <BackgroundPicker
            effect={bgEffect}
            unavailable={bgUnavailable}
            notice={bgNotice}
            onChange={(effect, image) => {
              // A deliberate choice clears an automatic suspension: the person
              // has been told why it stopped and is asking for it anyway.
              bgSuspendedRef.current = false;
              setBgNotice(null);
              void applyBackground(effect, image);
            }}
          />
        </div>
      </FloatingMenu>

      {/* Ending — the call is already down and the report can take a couple of
          minutes, so say so. Without this the screen is frozen video and a
          button that still looks live. */}
      {isAwaitingReport(callPhase) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col items-center gap-3 text-center">
            <span className="w-6 h-6 rounded-full border-2 border-[var(--gold-400)] border-t-transparent animate-spin" />
            <p className="text-sm font-semibold text-[var(--fg-primary)]">Ending the meeting…</p>
            <p className="text-xs text-[var(--fg-muted)]">
              Writing up the summary, action items and follow-up draft. This can take a minute on a long call.
            </p>
            {/* Always an exit. A slow model must never be a locked room. */}
            <button
              onClick={abandonReport}
              className="mt-1 text-xs text-[var(--fg-muted)] underline hover:text-[var(--fg-secondary)] transition-colors"
            >
              Leave without waiting
            </button>
          </div>
        </div>
      )}

      {/* Report generation error banner */}
      {callPhase === "failed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="rounded-2xl border border-status-danger/40 bg-[var(--surface-1)] shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
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
                onClick={() => { void endForAll(); }}
                className="flex-1 rounded-lg bg-[var(--status-danger)] hover:bg-red-600 text-white text-sm font-semibold py-2 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={abandonReport}
                className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--fg-primary)] text-sm font-medium py-2 transition-colors"
              >
                Exit anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </SpeakingProvider>
    </BodyPortal>
  );
}
