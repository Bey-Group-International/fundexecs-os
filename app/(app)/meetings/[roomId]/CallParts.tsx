"use client";

// The call screen's own pieces — tiles, control bar, sidebar, menus — split out
// of MeetingRoom so they load as their own chunk, fetched while the member is
// still in the green room rather than before it can be drawn.

import { FloatingMenu, useSpeaking, useStableHandlers, type RemovedPerson } from "./room-shared";
import {
  barCapacity,
  fitBar,
  foldedBadgeTotal,
  type BarFeature,
} from "@/lib/meetings/control-bar-fit";
import React, { memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
import { handsFirst } from "@/lib/meetings/hands";
import { mirrorSelfView } from "@/lib/meetings/stage";
import { REACTIONS, reactionLabel, type ActiveReaction } from "@/lib/meetings/reactions";
import { ChatText } from "./ChatText";
import { speakerColorIndex } from "@/lib/meetings/speaker-attribution";
import { CHAT_MAX_LENGTH, chatClock, groupChat, type ChatMessage, type ChatTurn } from "@/lib/meetings/chat";
import { MeetingShareLink, copyText } from "@/app/(app)/meetings/MeetingShareLink";
import { meetingInviteUrl } from "@/lib/meetings/share";
import { recordingNotice, type RecordingState } from "@/lib/meetings/recording-policy";
import { formatElapsed, type ElapsedState } from "@/lib/meetings/elapsed";
import { MeetingClock, RecordingClock } from "./MeetingClock";
import { exitLabel, hostLeaveNote, leaveWithoutEndingLabel } from "@/lib/meetings/call-phase";
import { linkNotice, peerStatusLabel, type BandwidthMode, type PeerLinkStatus } from "@/lib/meetings/connection";
import { subjectKey, type RemovalSubject } from "@/lib/meetings/removal";
import { type WaitingPeer } from "./WaitingScreens";
import { MeetingDocsPanel } from "./MeetingDocsPanel";

// Palette for per-speaker colours in the transcript.
/** No provider and no set: nobody is talking. */
const NOBODY: ReadonlySet<string> = new Set<string>();

const SPEAKER_COLORS = [
  "var(--gold-400)",
  "#7dd3fc",
  "#c4b5fd",
  "#86efac",
  "#fda4af",
  "#fdba74",
];

// ─── VideoTile ────────────────────────────────────────────────────────────────

/** The markup for one face. Exported memoised, as `VideoTile` below. */
function VideoTileImpl({
  stream, videoTrack, label, isLocal = false, showingScreenShare = false,
  handRaised = false, reaction = "", large = false,
  micOn = true, speaking = false, camOn = true, videoPaused = false,
  status = "live", watchId,
}: {
  stream: MediaStream | null;
  /**
   * The stream's live video track, passed IN rather than read off `stream` here.
   *
   * This looks redundant and is the only thing making the memo below correct. A
   * replaced track — a peer starting a screen share, switching camera, turning a
   * background on — is swapped into the SAME MediaStream object, so `stream`
   * compares equal across the update while its contents have changed. A memo
   * comparator cannot see that: both sides hold one object, and reading the
   * track from each gives the same answer, because there is no record of what
   * was there before. A prop is that record — React snapshots it at render time,
   * so the old track and the new one are two different values to compare.
   */
  videoTrack: MediaStreamTrack | null;
  label: string; isLocal?: boolean;
  /**
   * Whether this tile's video is a display capture rather than a camera.
   *
   * Only meaningful on the local tile, and only used to decide mirroring -- see
   * `mirrorSelfView`. Starting a share swaps the display capture into the same
   * local stream the camera was in, so the tile cannot tell from the stream
   * alone that it has stopped showing a face.
   */
  showingScreenShare?: boolean;
  handRaised?: boolean; reaction?: string; large?: boolean;
  /** That participant's own report of their mic track. */
  micOn?: boolean;
  /**
   * Their voice is in the room right now.
   *
   * Only consulted when `watchId` is absent — including inside the room, where a
   * store is provided but nobody has been named to watch. That is how this tile
   * stays renderable on its own with a plain boolean, as
   * MeetingRoom.tile.test.tsx does. Give it a `watchId` and that answers instead.
   */
  speaking?: boolean;
  /**
   * Whose voice to watch for, read live from the room's speaking store.
   *
   * The ring is the one thing on this tile that changes several times a second,
   * and subscribing to it here is what stops the room re-rendering to deliver
   * it — see createSpeakingStore's note. Leave it off and `speaking` decides.
   */
  watchId?: string;
  /** That participant's own report of their camera, which pixels cannot give us. */
  camOn?: boolean;
  /** Their video is off because the line could not carry it, not because they chose to. */
  videoPaused?: boolean;
  /** Where their connection is, so a frozen tile is never left unexplained. */
  status?: PeerLinkStatus;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const track = videoTrack;
  const isSpeaking = useSpeaking(watchId ?? "", speaking);
  // Re-render when the track's lifecycle changes (ends / mutes / unmutes) so the
  // placeholder appears/disappears in step with the real camera state.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Keep the <video> element ALWAYS mounted and (re)attach the stream whenever
  // it changes. If the <video> is unmounted while the camera is "off", a fresh
  // element re-mounts later with no srcObject and shows black; keeping it mounted
  // avoids that. Autoplay can be blocked, so call play() explicitly (joining is a
  // user gesture) and again on canplay once frames are ready.
  //
  // The element is ALWAYS muted, for every tile, local or remote. A tile is
  // pictures only: a remote voice is played once, by that peer's `PeerAudio`,
  // and never by a tile. Tiles are layout — the same person can be the stage
  // tile, then a strip thumbnail, then a grid cell, and every one of those moves
  // re-mounted or re-pointed an unmuted element at their stream. Each re-mount
  // restarted their audio, and any overlap played it twice, a beat apart: an
  // echo of the far end coming out of this room's speakers, and a second copy
  // the canceller has no clean reference for, so some of it went back out to
  // everyone else too. Set on the element as well as in the markup, because the
  // property, not the attribute, is what silences playback.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    if (el.srcObject !== (stream ?? null)) el.srcObject = stream ?? null;
    if (stream) void el.play().catch(() => { /* autoplay race — retried on canplay */ });
  }, [stream]);

  useEffect(() => {
    if (!track) return;
    track.addEventListener("ended", bump);
    track.addEventListener("mute", bump);
    track.addEventListener("unmute", bump);
    return () => {
      track.removeEventListener("ended", bump);
      track.removeEventListener("mute", bump);
      track.removeEventListener("unmute", bump);
    };
  }, [track]);

  // Show the video whenever there's an enabled, non-ended track — do NOT gate on
  // `track.muted`, which can stay true on some cameras/virtual cams even while
  // frames flow (that previously hid a working camera). The placeholder is only
  // shown when there's genuinely no live video to display, and the <video>
  // stays in the DOM underneath either way.
  //
  // `camOn` / `videoPaused` are what the far end says about itself, and they
  // decide the remote case on their own. A camera switched off keeps sending
  // black frames and a stream the network paused freezes on its last one, so
  // the pixels alone cannot tell "off" from "broken" — which is why a peer who
  // turned their camera off used to leave a black rectangle where a name and an
  // initial belong.
  const hasVideo = !!track && track.enabled && track.readyState !== "ended"
    && (isLocal || (camOn && !videoPaused));

  // "Reconnecting" outranks the rest: it is the only one that says the picture
  // is not coming back by itself.
  const notice = status === "reconnecting" ? "Reconnecting…"
    : status === "lost" ? "Connection lost"
    : status === "connecting" ? "Connecting…"
    : videoPaused ? "Video paused — weak connection"
    : "Camera off";

  // Ring the tile of whoever is talking. In a grid of muted faces this is the
  // fastest answer to "who is that?" — and it is the same judgement the
  // transcript is using to decide whose name goes on the words.
  const ring = isSpeaking && micOn ? "border-[var(--gold-400)] shadow-[0_0_0_2px_var(--gold-400)]" : "border-[var(--line)]";

  return (
    <div className={`relative rounded-2xl overflow-hidden bg-[var(--surface-2)] border transition-shadow flex items-center justify-center ${ring} ${large ? "w-full h-full" : "aspect-video"}`}>
      <video ref={videoRef} autoPlay playsInline muted
        onCanPlay={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
        className={`w-full h-full object-cover ${mirrorSelfView({ isLocal, showingScreenShare }) ? "scale-x-[-1]" : ""} ${hasVideo ? "" : "opacity-0"}`} />
      {!hasVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="w-12 h-12 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-lg font-semibold text-[var(--fg-primary)]">
            {label.slice(0, 1).toUpperCase()}
          </div>
          <span className="text-xs text-[var(--fg-muted)]">{notice}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-3 flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-xs text-white">
        {micOn
          ? isSpeaking && <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold-400)] animate-pulse" />
          : <span title="Muted — not being transcribed" aria-label="Muted">🔇</span>}
        {label}{isLocal ? " (You)" : ""}
      </div>
      {hasVideo && (peerStatusLabel(status) ?? (videoPaused ? "Video paused" : null)) && (
        <div className="absolute top-2 left-3 rounded-full bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[11px] text-white">
          {peerStatusLabel(status) ?? "Video paused"}
        </div>
      )}
      {handRaised && <div className="absolute top-2 right-3 text-lg">✋</div>}
      {/* Decorative: ReactionTicker is what announces a reaction, and reading
          it from both places would say it twice. */}
      {reaction && (
        <div aria-hidden="true" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl animate-bounce pointer-events-none select-none">
          {reaction}
        </div>
      )}
    </div>
  );
}

/**
 * One face in the room, re-rendered when something about THAT participant
 * changed and not before.
 *
 * Without this, everything that re-renders MeetingRoom re-rendered every tile in
 * the call: a transcript line landing, a chat message arriving, somebody
 * starting or stopping talking — up to eight times a second, since the analyser
 * samples at 120ms. None of those change most tiles, and all of them were
 * reconciling all of them, on the same main thread that is decoding the video.
 *
 * The default shallow comparison is enough because every prop is a primitive
 * except `stream` and `videoTrack`, and those two are compared by identity —
 * which is exactly why the track is a prop. See the note on it above.
 */
export const VideoTile = React.memo(VideoTileImpl);

// ─── PeerAudio ────────────────────────────────────────────────────────────────

/**
 * The one place a remote participant's voice is played.
 *
 * Exactly one per peer, keyed by peer id and mounted beside the stage rather
 * than inside it, so changing layout, focus or the strip never touches it: the
 * voice does not restart, and can never be playing from two elements at once.
 * See the note on the tile's <video> for what went wrong when tiles carried it.
 *
 * An <audio> playing a WebRTC track is also the path the browser's echo
 * canceller takes its reference from, so what comes out of the speakers here is
 * what gets subtracted from the microphone.
 *
 * `audioTrack` is passed in for the same reason `videoTrack` is on the tile: a
 * replaced track arrives inside the same MediaStream object, and without it the
 * memo would not see the change and `play()` would not be re-tried.
 */
function PeerAudioImpl({ stream, audioTrack, silenced = false }: {
  stream: MediaStream | null;
  audioTrack: MediaStreamTrack | null;
  /**
   * Not played on this device. Set when the peer is in the same room and their
   * audio was carrying this member's own voice back (see voice-return.ts). The
   * element stays mounted and attached, so un-silencing is instant.
   */
  silenced?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.muted = silenced;
  }, [silenced]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const source = audioTrack ? stream : null;
    if (el.srcObject !== source) el.srcObject = source;
    if (!source) return;
    // Autoplay with sound can be refused until the page has been interacted
    // with. Joining is a click, so this is rare, but a voice that silently never
    // starts is the worst failure a call has: try again on the next gesture.
    //
    // The retry listens for `click`, `touchend` and `keydown`, and stays armed
    // until a play actually succeeds. It used to be a one-shot `pointerdown`:
    // on iOS a touch's pointerdown is not a user activation (WebKit activates
    // on touchend / click), so the single retry was spent on the one event
    // that could not unlock audio, and a listen-only member on an iPhone —
    // the case the autoplay exemption for capturing pages does not cover —
    // never heard the call.
    const GESTURES = ["click", "touchend", "keydown"] as const;
    const disarm = () => { for (const type of GESTURES) document.removeEventListener(type, play); };
    const play = () => {
      const attempt = el.play();
      if (attempt && typeof attempt.then === "function") {
        attempt.then(disarm).catch(() => { /* still blocked — the next gesture retries */ });
      }
    };
    play();
    for (const type of GESTURES) document.addEventListener(type, play);
    return disarm;
  }, [stream, audioTrack]);

  // Release the device's playback on the way out rather than when the element
  // is collected.
  useEffect(() => () => {
    const el = ref.current;
    if (el) { try { el.pause(); el.srcObject = null; } catch { /* already gone */ } }
  }, []);

  return <audio ref={ref} autoPlay data-peer-audio="" className="hidden" />;
}

export const PeerAudio = React.memo(PeerAudioImpl);


// ─── DeviceChevron ────────────────────────────────────────────────────────────

/**
 * The device picker beside the mic and camera buttons.
 *
 * `activeId` is the device the call is actually running on, read back from the
 * live track rather than from whatever was requested — the two differ exactly
 * when it matters. A request for the system default resolves to a concrete
 * device, and a camera that was busy at join time is quietly replaced by
 * another, so a menu that ticked the requested id would tell a member they are
 * on their headset while they talk into their laptop.
 *
 * The list is re-read every time the menu opens, and again on `devicechange`
 * while it is open: plugging a headset in with the picker showing and not
 * seeing it there is the moment somebody decides the meeting is broken.
 */
function DeviceChevron({ kind, activeId, onSelect }: {
  kind: "audioinput" | "videoinput" | "audiooutput";
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([]);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevs(all.filter((d) => d.kind === kind && d.deviceId));
    } catch { setDevs([]); }
  }, [kind]);

  useEffect(() => {
    if (!open) return;
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { void refresh(); };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [open, refresh]);

  const label = kind === "audioinput" ? "Microphone" : kind === "videoinput" ? "Camera" : "Speaker";

  return (
    <>
      <button ref={anchorRef} aria-label={`Choose ${label.toLowerCase()}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { if (open) { setOpen(false); return; } void refresh(); setOpen(true); }}
        className="flex items-center justify-center w-5 h-10 text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      <FloatingMenu open={open} anchorRef={anchorRef} onClose={() => setOpen(false)}>
        <p className="text-[11px] font-medium text-[var(--fg-muted)] uppercase tracking-wide px-2 py-1">{label}</p>
        {devs.length === 0 ? <p className="text-xs text-[var(--fg-muted)] px-2 py-1">No devices found</p> : devs.map((d: MediaDeviceInfo) => {
          const live = !!activeId && d.deviceId === activeId;
          return (
            <button key={d.deviceId} role="menuitemradio" aria-checked={live}
              onClick={() => { onSelect(d.deviceId); setOpen(false); }}
              className={`w-full flex items-center gap-1.5 text-left text-xs px-2 py-1.5 rounded-lg transition-colors hover:bg-[var(--surface-3)] ${
                live ? "text-[var(--gold-400)]" : "text-[var(--fg-primary)]"
              }`}>
              {/* Always rendered, so the rows line up whether or not one is live. */}
              <span aria-hidden="true" className="w-3 shrink-0 text-center">{live ? "\u2713" : ""}</span>
              <span className="truncate">{d.label || `Device ${d.deviceId.slice(0, 6)}`}</span>
            </button>
          );
        })}
      </FloatingMenu>
    </>
  );
}

// ─── WaitingRoomBar ──────────────────────────────────────────────────────────

// ─── HostExitControl ──────────────────────────────────────────────────────────

/**
 * The host's two ways out of a live meeting.
 *
 * A host used to have one, and it took the whole room with it. Ending is still
 * the primary press — it is what a host usually means — but it is not the only
 * thing a host ever wants, and the alternative to offering the second exit was
 * not "hosts never leave early": it was hosts closing the tab, which leaves the
 * room running with nobody able to end it and no report at the end.
 *
 * The chevron is the confirmation step. Leaving without ending has a cost that
 * lands on other people — only the host can admit from the waiting room — so
 * that cost is written inside the menu, next to the control that causes it,
 * where it can still change the decision. A separate dialog would put it one
 * click further from the thing it is about.
 */
export function HostExitControl({
  leaving, waitingCount, onLeave, onEndForAll,
}: {
  /** The call is already being torn down — neither exit may re-fire. */
  leaving: boolean;
  /** Guests who would be stranded, because admission is host-only. */
  waitingCount: number;
  onLeave: () => void;
  onEndForAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const chevronRef = useRef<HTMLButtonElement>(null);

  // Closing on the same press that leaves avoids a menu left hanging over the
  // exit screen: teardown unmounts this bar, but the portal is on document.body.
  const leaveWithoutEnding = () => { setOpen(false); onLeave(); };

  return (
    <div className="flex items-center">
      {/* The label is the button's only text and it is display:none below `lg`,
          which takes it out of the accessibility tree — and PhoneOffIcon is a
          bare <svg> with no text alternative, so on a phone this announced as
          an unnamed button. aria-label matches the visible text exactly, so the
          two never disagree where both are present.

          Closing the menu is not cosmetic: the ControlBar stays mounted under
          the "ending" overlay, and FloatingMenu portals to document.body at
          z-[9999] against that overlay's z-50 — so a menu left open would hang
          over the report-generating screen. The leave path already closed it;
          this is the same rule applied to the path that ends the call. */}
      <button onClick={() => { setOpen(false); onEndForAll(); }} disabled={leaving} aria-busy={leaving}
        aria-label={exitLabel(leaving ? "ending" : "live", true)}
        className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-l-full rounded-r-none bg-[var(--status-danger)] hover:bg-red-600 disabled:opacity-60 disabled:cursor-wait text-white text-sm font-medium pl-2.5 sm:pl-4 lg:pl-5 pr-1.5 sm:pr-2 lg:pr-3 py-2 transition-colors">
        <PhoneOffIcon /> <span className="hidden lg:inline">{exitLabel(leaving ? "ending" : "live", true)}</span>
      </button>
      {/* A hairline, so the two halves read as two actions rather than one wide
          button that happens to have an arrow on it. */}
      <span aria-hidden="true" className="w-px self-stretch bg-white/25" />
      <button ref={chevronRef} onClick={() => setOpen((v: boolean) => !v)} disabled={leaving}
        aria-label="Other ways to leave" aria-haspopup="menu" aria-expanded={open}
        className="flex items-center justify-center rounded-r-full rounded-l-none bg-[var(--status-danger)] hover:bg-red-600 disabled:opacity-60 disabled:cursor-wait text-white pl-1.5 pr-2 sm:pr-3 py-2 self-stretch transition-colors">
        <svg width="10" height="10" viewBox="0 0 8 8" fill="none">
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      <FloatingMenu open={open} anchorRef={chevronRef} onClose={() => setOpen(false)} minWidth={260}>
        <button role="menuitem" onClick={leaveWithoutEnding} disabled={leaving}
          className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--surface-3)] disabled:opacity-60 disabled:cursor-wait transition-colors">
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--fg-primary)]">
            <PhoneOffIcon /> {leaveWithoutEndingLabel(leaving ? "ending" : "live")}
          </span>
          <span className="block mt-1 text-xs leading-snug text-[var(--fg-muted)]">
            {hostLeaveNote(waitingCount)}
          </span>
        </button>
      </FloatingMenu>
    </div>
  );
}

// ─── ControlBar ───────────────────────────────────────────────────────────────


/** The bar re-renders only when one of its own props changes. */
export const ControlBar = React.memo(ControlBarImpl);

/** The `sm` breakpoint, as a query and as a number, so one value drives both. */
const SHARE_MIN_WIDTH = "(min-width: 640px)";

/**
 * Whether the screen is wide enough to be offered a screen share.
 *
 * Reads `matchMedia` when the browser has it and falls back to the width, so a
 * host without it — jsdom in these tests, an old embedded view — gets an answer
 * rather than an exception thrown from inside a live call's control bar.
 */
function wideEnough(): boolean {
  if (typeof window === "undefined") return true;
  if (typeof window.matchMedia === "function") return window.matchMedia(SHARE_MIN_WIDTH).matches;
  return window.innerWidth >= 640;
}

/**
 * Whether this browser can capture a screen at all.
 *
 * Width is still the main test (see the note on `wideEnoughToShare`), but an
 * iPad in Safari is wider than `sm` and has no `getDisplayMedia` whatsoever:
 * the Share button was offered there and did nothing, because the TypeError
 * from calling an undefined method landed in the same catch as a cancelled
 * picker. A browser without the method cannot be asked, so it is not offered.
 */
function canCaptureDisplay(): boolean {
  if (typeof navigator === "undefined") return true;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

function ControlBarImpl({
  micOn, camOn, micTitle, camTitle, shareOn, shareStarting, panel, canShareDocs = false, participantCount = 1, isHost, handRaised, handsUp, handsUpNote, layout, layoutForced, chatUnread, waitingCount, elapsed, roomCode, bwMode,
  onToggleMic, onToggleCam, onToggleScreen, onOpenPanel, onLeave, onEndForAll,
  onSwitchMic, onSwitchCam, onSwitchSpeaker, onRaiseHand, onReaction, onMuteAll, onToggleLayout, onFlipCamera,
  activeMicId, activeCamId, camStarting,
  leaving, onOpenBackgrounds, backgroundActive, backgroundBtnRef,
  recordingState, recordingBy, recordingStartedAt, onToggleRecording,
}: {
  /** Drives the badge every participant sees, and the host's own control. */
  recordingState: RecordingState;
  /** Who is recording. Shown to everyone: "the host knew" is not consent. */
  recordingBy: string;
  /** When the running recording started (epoch ms). The button ticks its own clock from it. */
  recordingStartedAt: number | null;
  onToggleRecording: () => void;
  onOpenBackgrounds: () => void;
  /** An effect is applied, so the control reads as on. */
  backgroundActive: boolean;
  backgroundBtnRef: React.RefObject<HTMLButtonElement | null>;
  /** The call is already being torn down — the exit controls must not re-fire. */
  leaving: boolean;
  micOn: boolean; camOn: boolean; shareOn: boolean; shareStarting: boolean; isHost: boolean;
  /**
   * Which side-panel tab is open, or null when the panel is closed.
   *
   * The panel had one button, "✨ Copilot", which opened it on whichever tab
   * it was last left on, and whose single badge showed the waiting count in
   * preference to unread chat — so a host with someone at the door could not
   * see that anyone had written. Chat, People and Documents now each have a
   * button and a badge of their own, and pressing the one already open closes
   * the panel.
   */
  panel: PanelTab | null;
  /** Offer the Documents button. A guest has no firm to share from. */
  canShareDocs?: boolean;
  /** Everyone in the call, you included — the People button says how many. */
  participantCount?: number;
  /** What the mic/camera buttons say. Omitted falls back to the plain wording. */
  micTitle?: string; camTitle?: string;
  handRaised: boolean; layout: "grid" | "speaker"; chatUnread: number; waitingCount: number;
  /**
   * Live-span bookkeeping for the meeting clock, passed as a ref so this bar's
   * props do not change when a second passes. MeetingClock ticks itself.
   */
  elapsed: { readonly current: ElapsedState };
  /**
   * How many OTHER people have a hand up, and how to say it.
   *
   * A raised hand used to live only on a tile and in a sidebar tab — both
   * off-screen most of the time — while a one-word chat message lit a badge
   * here. Somebody asking to speak deserves at least that.
   */
  handsUp: number; handsUpNote: string;
  roomCode: string; bwMode: BandwidthMode;
  /** A live screen share is holding speaker view open over the chosen grid. */
  layoutForced: boolean;
  onToggleMic: () => void; onToggleCam: () => void; onToggleScreen: () => void;
  /** Open the panel on a tab, or close it when that tab is the one showing. */
  onOpenPanel: (tab: PanelTab) => void;
  onLeave: () => void; onEndForAll: () => void;
  onSwitchMic: (id: string) => void; onSwitchCam: (id: string) => void; onSwitchSpeaker: (id: string) => void;
  /** The devices the call is actually running on, so the pickers can say so. */
  activeMicId: string; activeCamId: string;
  camStarting: boolean;
  onRaiseHand: () => void; onReaction: (emoji: string) => void; onMuteAll: () => void; onToggleLayout: () => void;
  onFlipCamera: () => void;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const reactionBtnRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [linkCopied, setLinkCopied] = useState<boolean | null>(null);
  const bgOwnRef = useRef<HTMLButtonElement>(null);

  // The background picker is the room's, anchored to the ref it hands in. On a
  // phone the Background button is display:none and the picker is opened from
  // More instead — and anchored to a hidden button it would open in the top
  // corner of the screen. So the ref points at whichever button was pressed.
  const openBackgroundsFrom = (from: React.RefObject<HTMLButtonElement | null>) => {
    backgroundBtnRef.current = from.current;
    onOpenBackgrounds();
  };

  // Every item in the More menu closes it as it acts: the menu portals to the
  // body, above the "ending" overlay, and must not be left hanging there.
  const fromMore = (act: () => void) => () => { setMoreOpen(false); act(); };

  const copyLink = async () => {
    const ok = await copyText(meetingInviteUrl(window.location.origin, roomCode));
    setLinkCopied(ok);
    setTimeout(() => setLinkCopied(null), 2000);
  };

  const recording = recordingState === "recording";
  const recordLabel = recording ? "Stop recording"
    : recordingState === "starting" ? "Starting…"
    : recordingState === "stopping" ? "Saving…"
    : "Record";
  // The full wording, which the buttons are named by; their visible word is a
  // shortened form of it, and "Retry" when there is no device to unmute.
  const micAction = micTitle ?? (micOn ? "Mute" : "Unmute");
  // ── How much of the bar actually fits ───────────────────────────────────
  //
  // Measured, because a breakpoint cannot know. The row gets whatever is left
  // after the recording pill, the degraded-link notice and the exit — and those
  // come and go during a call, so a width that fitted a minute ago does not fit
  // now. At `xl` every button also gains a label and a wider minimum at the same
  // width that reveals more of them.
  //
  // What a browser actually showed, before any of this: on a 320px phone the exit
  // hangs 14px off the right for a guest and 30px for a host, and no breakpoint
  // can fix it because the exit never folds. See lib/meetings/control-bar-fit.ts
  // for the measurements and for what folds first.
  const rowRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  /** Controls a breakpoint is hiding right now, from the same measurement. */
  const [hiddenByWidth, setHiddenByWidth] = useState<BarFeature[]>([]);
  /**
   * The width of one foldable control, remembered.
   *
   * Needed because the measurement eats itself at the narrow end. Once every
   * foldable control has gone into More there is nothing left on the bar to
   * measure one by, and the first version answered "I cannot tell" — which folds
   * nothing, so every control came back, and the row overflowed again. Chromium
   * at 320px: the first measurement folded all of them, the ResizeObserver's own
   * opening callback then measured a bar with no foldable control in it, and the
   * bar ended up exactly as wide as it had been before any of this existed. None
   * of the jsdom tests could see it, because their observer answers before React
   * has committed the fold.
   *
   * A control's width does not depend on whether it is currently on the bar, so
   * the last one seen is a sound unit to keep using.
   */
  const itemWidthRef = useRef(0);
  /**
   * Whether this screen is wide enough to offer a screen share.
   *
   * Declared here, above the measurement, because the measurement depends on it —
   * see the effect below for why screen size is the test and the comment on the
   * dependency array for what crossing it changes.
   */
  const [wideEnoughToShare, setWideEnoughToShare] = useState(wideEnough);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const available = row.clientWidth;
      // Every optional control is tagged, so the ones that can never fold — the
      // mic and camera with their chevrons, More itself, the exit — are simply
      // "everything else" and need no second list to drift out of step.
      const optional = [...row.querySelectorAll<HTMLElement>("[data-bar-feature]")];
      // Computed as "everything, minus the controls that may fold", because the
      // foldable ones are nested inside groups rather than sitting directly in the
      // row — summing the row's own children would count a whole group as
      // unfoldable. Subtracting instead works at any depth, and stays correct as
      // controls fold: the total shrinks by exactly what left.
      let total = 0;
      for (const child of [...row.children]) total += (child as HTMLElement).offsetWidth;
      const optionalWidth = optional.reduce((w, el) => w + el.offsetWidth, 0);
      const reserved = Math.max(0, total - optionalWidth);
      // The WIDEST optional control, not the average. Fitting to the average
      // over-fills by however much the widest exceeds it, which puts a control
      // back off the edge — and erring toward one control too few in the bar
      // costs a press, while erring the other way costs reachability.
      const widest = optional.reduce((w, el) => Math.max(w, el.offsetWidth), 0);
      // A control a breakpoint has hidden measures zero, which is how the fold
      // learns which ones CSS has already taken off the bar. It matters for the
      // badge: a hidden control is as quiet as a folded one, and the number it
      // was carrying has to move onto More either way.
      const unseen = optional.filter((el) => el.offsetWidth === 0).map((el) => el.dataset.barFeature as BarFeature);
      setHiddenByWidth((prev) =>
        prev.length === unseen.length && prev.every((f, i) => f === unseen[i]) ? prev : unseen,
      );
      // The row's gap at every breakpoint it uses (gap-1 / sm:gap-1.5).
      const gap = 6;
      if (widest > 0) itemWidthRef.current = widest;
      // The remembered width when there is nothing left on the bar to measure.
      // Null only before anything has ever been measured, which is the one
      // honest "not yet" — see itemWidthRef.
      const unit = widest > 0 ? widest : itemWidthRef.current;
      setCapacity(
        unit > 0
          ? barCapacity({ available, itemWidth: unit + gap, reserved: reserved + gap * (row.children.length - 1) })
          : null,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
    // Re-measured when the composition of the bar changes, because the reserved
    // width does: a recording pill appears, a bandwidth notice comes and goes,
    // and a host's exit is wider than a guest's.
    //
    // `wideEnoughToShare` is in here because the `sm` breakpoint moves three
    // things at once: screen share is offered or withdrawn, every button goes
    // from 42px to 40px, and the mic and camera chevrons appear. Two of those
    // change the width of one control and the width of the part that cannot fold,
    // and the ResizeObserver below cannot be relied on to notice — it fires when
    // the ROW's own box changes, and the row sits between two columns whose
    // contents also change at `sm`, so there are widths where everything inside
    // it resizes and its box does not. A capacity measured on the wide side then
    // keeps more controls than the narrow bar can hold, which is the fault this
    // whole change exists to fix. (CodeRabbit's finding on #1296.)
  }, [isHost, recordingState, bwMode, canShareDocs, leaving, wideEnoughToShare]);

  /**
   * Mirrors the `sm` breakpoint the screen-share button was gated on.
   *
   * Carried as data rather than a CSS class so the fold can see it — a control
   * the fold cannot see is a control it will happily leave hanging off the edge.
   * Screen size remains the proxy: every mobile browser exposes
   * `getDisplayMedia` and then refuses it, so the API's presence is not the test
   * (see lib/meetings/audio-capture.ts). Its ABSENCE is, though — iPadOS Safari
   * is the one wide screen with no method at all (see `canCaptureDisplay`).
   */
  useEffect(() => {
    // `matchMedia` where it exists, a resize listener where it does not. Feature
    // detected rather than assumed: this runs inside the control bar of a live
    // call, and a throw here takes the whole bar down — which is a worse fault
    // than the one this is here to fix.
    const read = () => setWideEnoughToShare(wideEnough() && canCaptureDisplay());
    read();
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(SHARE_MIN_WIDTH) : null;
    if (mq?.addEventListener) {
      mq.addEventListener("change", read);
      return () => mq.removeEventListener("change", read);
    }
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const offered: BarFeature[] = [
    "background",
    ...(wideEnoughToShare ? (["share"] as const) : []),
    "hand",
    "react",
    "layout",
    ...(isHost ? (["record"] as const) : []),
    "chat",
    "people",
    ...(canShareDocs ? (["docs"] as const) : []),
  ];
  const fit = fitBar({ offered, capacity });
  const onBar = (f: BarFeature) => fit.inBar.includes(f);
  /**
   * More carries a twin of everything the call offers, folded or not — the class
   * decides which widths it shows at, so that the breakpoint floor still works
   * before the measurement has run. A control the call does not offer at all (a
   * guest's documents, a member's recording, a phone's screen share) has no twin.
   */
  const inMore = (f: BarFeature) => offered.includes(f);
  const barClass = (f: BarFeature) => BAR_AT_WIDTH[f].bar;
  /** Unconditional once the fold has taken the button away; the mirror until then. */
  const moreClass = (f: BarFeature) => (onBar(f) ? BAR_AT_WIDTH[f].more : "");
  const foldState = (f: BarFeature) => (onBar(f) ? "mirror" : "folded");
  // Folding a control must not fold the number it was carrying — and nor must a
  // breakpoint hiding it, which is why both are counted.
  const quiet = [...new Set([...fit.folded, ...hiddenByWidth])];
  const moreBadge = foldedBadgeTotal(quiet, {
    chat: chatUnread > 0 && panel !== "chat" ? chatUnread : 0,
    people: waitingCount,
    hand: handsUp,
  });

  const camAction = camTitle ?? (camOn ? "Camera off" : "Camera on");
  const handLabel = handRaised ? "Lower hand" : "Raise hand";
  const layoutLabel = layout === "grid" ? "Speaker view" : "Grid view";

  return (
    // The bottom padding grows by the safe-area inset: the call overlay is
    // portalled to <body> under `viewport-fit=cover`, so without it the bar
    // sat under the iPhone's home indicator.
    <div className="flex items-center justify-between gap-1.5 sm:gap-2 px-1.5 sm:px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] border-t border-[var(--line)] bg-[var(--surface-1)] shrink-0">
      {/* Left: the clock, and the two things everybody must be able to see —
          that the call is recorded, and that their link is struggling. The
          recording badge is never hidden on a small screen: several US states
          require every party to a conversation to know it is being recorded,
          and a badge that collapses on a phone is one the guest on a phone
          never saw. */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0 2xl:w-56">
        <MeetingClock elapsed={elapsed} className="hidden sm:block text-xs font-mono text-[var(--fg-muted)] tabular-nums" />
        {recordingState !== "idle" && (
          <span
            role="img"
            aria-label={recordingNotice(recordingState, recordingBy) ?? "Recording"}
            title={recordingNotice(recordingState, recordingBy) ?? undefined}
            className="flex items-center gap-1.5 rounded-full border border-[var(--status-danger)] bg-red-500/10 px-2 py-1 text-xs font-medium text-[var(--status-danger)]"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--status-danger)] animate-pulse" />
            <span className="hidden lg:inline">
              {recordingState === "recording" ? "Recording" : recordingState === "stopping" ? "Saving" : "Starting"}
            </span>
          </span>
        )}
        {linkNotice(bwMode) && (
          <span title={linkNotice(bwMode)!} className="text-xs text-[var(--status-warning)] flex items-center gap-1 border border-status-warning/30 rounded-full px-2 py-1">
            📶 <span className="hidden lg:inline">{bwMode === "audio-only" ? "Video paused" : "Reduced quality"}</span>
          </span>
        )}
      </div>

      {/* Centre: the call itself, in groups — your devices, how you take part,
          the host's tools, and the way out. Labelled on a wide screen; below it the
          icons carry aria-labels, and what does not fit a phone moves into
          More rather than off the screen. */}
      <div ref={rowRef} className="flex items-center gap-1 sm:gap-1.5 flex-1 justify-center min-w-0">
        <BarGroup>
          <div className="flex items-center">
            {/* The caption is decided by `participation.ts` and passed in, not
                derived from `micOn` here. "Unmute" is a promise, and a member
                with no microphone was being given it. */}
            <BarBtn tone={micOn ? "default" : "off"} onClick={onToggleMic}
              label={micAction.startsWith("No ") ? "Retry" : micOn ? "Mute" : "Unmute"} title={micAction} ariaLabel={micAction}
              icon={micOn ? <MicIcon /> : <MicOffIcon />} />
            <span className="hidden sm:block"><DeviceChevron kind="audioinput" activeId={activeMicId} onSelect={onSwitchMic} /></span>
          </div>
          <div className="flex items-center">
            <BarBtn tone={camOn ? "default" : "off"} onClick={onToggleCam} busy={camStarting}
              label={camAction.startsWith("No ") ? "Retry" : camOn ? "Stop video" : "Start video"} title={camAction} ariaLabel={camAction}
              icon={camOn ? <CamIcon /> : <CamOffIcon />} />
            <span className="hidden sm:block"><DeviceChevron kind="videoinput" activeId={activeCamId} onSelect={onSwitchCam} /></span>
          </div>
          {/* Backgrounds — next to the camera, because that is what it changes.
              Below `md` it is in More, where the anchor for its picker is the
              More button. */}
          {onBar("background") && (
            <BarBtn dataFeature="background" btnRef={bgOwnRef} className={barClass("background")} tone={backgroundActive ? "on" : "default"}
              onClick={() => openBackgroundsFrom(bgOwnRef)} label="Background" title="Background effects" icon={<BackgroundIcon />} />
          )}
          {/* Screen share — not offered on a phone, which cannot. */}
          {onBar("share") && (
            <BarBtn dataFeature="share" className={barClass("share")} tone={shareOn ? "on" : "default"} onClick={onToggleScreen} busy={shareStarting}
              label={shareOn ? "Stop share" : "Share"} title={shareOn ? "Stop sharing" : "Share screen"} pressed={shareOn}
              icon={<ScreenShareIcon />} />
          )}
        </BarGroup>

        <BarGroup>
          {/* Raise hand — and the badge that says somebody else has. In More on a
              phone, where the badge moves onto the More button. */}
          {onBar("hand") && (
            <BarBtn dataFeature="hand" className={barClass("hand")} tone={handRaised ? "on" : "default"} onClick={onRaiseHand} pressed={handRaised}
              label={handRaised ? "Lower" : "Raise"} title={handsUpNote || handLabel}
              ariaLabel={handsUpNote ? `${handLabel}. ${handsUpNote}.` : handLabel}
              icon={<span className="text-base leading-none">✋</span>} badge={handsUp > 0 ? handsUp : null} />
          )}
          {onBar("react") && (
            <BarBtn dataFeature="react" btnRef={reactionBtnRef} className={barClass("react")} onClick={() => setReactionOpen((v: boolean) => !v)}
              label="React" title="Send reaction" haspopup expanded={reactionOpen}
              icon={<span className="text-base leading-none">😊</span>} />
          )}
          <FloatingMenu open={reactionOpen} anchorRef={reactionBtnRef} onClose={() => setReactionOpen(false)} minWidth={0}>
            <ReactionRow onReaction={(emoji) => { onReaction(emoji); setReactionOpen(false); }} />
          </FloatingMenu>
          {onBar("layout") && (
          <BarBtn dataFeature="layout" className={barClass("layout")} onClick={onToggleLayout} label={layout === "grid" ? "Speaker" : "Grid"}
            ariaLabel={layoutLabel}
            title={layoutForced ? "Someone is sharing their screen — grid view resumes when they stop" : layoutLabel}
            icon={layout === "grid" ? <SpeakerViewIcon /> : <GridViewIcon />} />
          )}
        </BarGroup>

        {/* Record — host only. On a phone too: a host running the meeting from
            a phone is exactly the host most likely to want a recording. */}
        {isHost && onBar("record") && (
          <BarGroup className={barClass("record")}>
            <BarBtn dataFeature="record" tone={recording ? "recording" : "default"} onClick={onToggleRecording}
              disabled={recordingState === "starting" || recordingState === "stopping"} pressed={recording}
              label={recording && recordingStartedAt !== null ? <RecordingClock startedAt={recordingStartedAt} /> : recordLabel}
              ariaLabel={recording ? "Stop recording" : recordLabel === "Record" ? "Record this meeting" : recordLabel}
              title={recording ? "Stop recording" : "Record this meeting"}
              icon={<span className={`w-3 h-3 rounded-full ${recording ? "bg-[var(--status-danger)] animate-pulse" : "bg-current"}`} />} />
          </BarGroup>
        )}

        {/* Chat, People and Documents. A button each, so each has its own
            badge: unread chat no longer hides behind people at the door. */}
        <BarGroup>
          {onBar("chat") && (
          <BarBtn dataFeature="chat" className={barClass("chat")} tone={panel === "chat" ? "on" : "default"} onClick={() => onOpenPanel("chat")} pressed={panel === "chat"}
            label="Chat" ariaLabel={chatUnread > 0 && panel !== "chat" ? `Chat, ${chatUnread} unread` : "Chat"}
            title={chatUnread > 0 && panel !== "chat" ? `${chatUnread} unread` : "Chat"}
            icon={<ChatIcon />} badge={chatUnread > 0 && panel !== "chat" ? chatUnread : null} />
          )}
          {onBar("people") && (
          <BarBtn dataFeature="people" className={barClass("people")} tone={panel === "people" ? "on" : "default"} onClick={() => onOpenPanel("people")} pressed={panel === "people"}
            label="People"
            ariaLabel={waitingCount > 0 ? `People, ${waitingCount} waiting to join` : `People, ${participantCount} in the call`}
            title={waitingCount > 0 ? `${waitingCount} waiting to join` : `${participantCount} in the call`}
            icon={<PeopleIcon />}
            // Someone at the door is the badge; otherwise the headcount, quietly.
            badge={waitingCount > 0 ? waitingCount : null} badgeTone="success"
            hint={waitingCount > 0 ? null : participantCount} />
          )}
          {canShareDocs && onBar("docs") && (
            <BarBtn dataFeature="docs" className={barClass("docs")} tone={panel === "docs" ? "on" : "default"} onClick={() => onOpenPanel("docs")}
              pressed={panel === "docs"} label="Docs" ariaLabel="Documents" title="Share from the data room" icon={<DocsIcon />} />
          )}
        </BarGroup>

        <BarGroup>
          {/* More: everything that does not earn a place on the bar at this
              width. Its items are sized by breakpoint so the same control is
              never offered twice on one screen. */}
          <BarBtn btnRef={moreBtnRef} onClick={() => setMoreOpen((v: boolean) => !v)} label="More" ariaLabel="More options"
            title="More options" haspopup expanded={moreOpen} icon={<MoreIcon />}
            badge={moreBadge} />
          <FloatingMenu open={moreOpen} anchorRef={moreBtnRef} onClose={() => setMoreOpen(false)} minWidth={220}>
            {/* Each item appears exactly when its button did not, so no control is
                ever offered twice on one screen — the same guarantee the mirrored
                breakpoint classes used to give, now from one decision instead of
                two that could disagree. */}
            {inMore("react") && (
              <div data-bar-feature="react" data-fold={foldState("react")}
                className={`${moreClass("react")} px-1 pt-1 pb-1.5 border-b border-[var(--line)] mb-1`}>
                <ReactionRow onReaction={(emoji) => { onReaction(emoji); setMoreOpen(false); }} />
              </div>
            )}
            {inMore("chat") && (
              <MenuItem dataFeature="chat" dataFold={foldState("chat")} className={moreClass("chat")}
                onClick={fromMore(() => onOpenPanel("chat"))}>
                <ChatIcon /> Chat
                {chatUnread > 0 && panel !== "chat"
                  ? <span className="ml-auto text-xs font-semibold text-[var(--gold-400)]">{chatUnread} unread</span>
                  : null}
              </MenuItem>
            )}
            {inMore("people") && (
              <MenuItem dataFeature="people" dataFold={foldState("people")} className={moreClass("people")}
                onClick={fromMore(() => onOpenPanel("people"))}>
                <PeopleIcon /> People
                <span className="ml-auto text-xs text-[var(--fg-muted)]">
                  {waitingCount > 0 ? `${waitingCount} waiting` : participantCount}
                </span>
              </MenuItem>
            )}
            {inMore("share") && (
              <MenuItem dataFeature="share" dataFold={foldState("share")} className={moreClass("share")}
                onClick={fromMore(onToggleScreen)}>
                <ScreenShareIcon /> {shareOn ? "Stop sharing" : "Share screen"}
              </MenuItem>
            )}
            {inMore("hand") && (
              <MenuItem dataFeature="hand" dataFold={foldState("hand")} className={moreClass("hand")}
                onClick={fromMore(onRaiseHand)}>
                ✋ {handLabel}{handsUpNote ? <span className="ml-auto text-xs text-[var(--fg-muted)]">{handsUpNote}</span> : null}
              </MenuItem>
            )}
            {inMore("background") && (
              <MenuItem dataFeature="background" dataFold={foldState("background")} className={moreClass("background")}
                onClick={fromMore(() => openBackgroundsFrom(moreBtnRef))}>
                <BackgroundIcon /> Background effects{backgroundActive ? " · on" : ""}
              </MenuItem>
            )}
            {/* Flip camera is a phone's control and has never had a bar button,
                so it stays gated on screen size rather than on the fold. */}
            <MenuItem className="sm:hidden" onClick={fromMore(onFlipCamera)}>🔄 Flip camera</MenuItem>
            {inMore("docs") && (
              <MenuItem dataFeature="docs" dataFold={foldState("docs")} className={moreClass("docs")}
                onClick={fromMore(() => onOpenPanel("docs"))}><DocsIcon /> Documents</MenuItem>
            )}
            {inMore("layout") && (
              <MenuItem dataFeature="layout" dataFold={foldState("layout")} className={moreClass("layout")}
                onClick={fromMore(onToggleLayout)}>
                {layout === "grid" ? <SpeakerViewIcon /> : <GridViewIcon />} {layoutLabel}
              </MenuItem>
            )}
            {inMore("record") && (
              <MenuItem dataFeature="record" dataFold={foldState("record")} className={moreClass("record")}
                onClick={fromMore(onToggleRecording)}
                disabled={recordingState === "starting" || recordingState === "stopping"}>
                <span className={`w-2.5 h-2.5 rounded-full ${recording ? "bg-[var(--status-danger)]" : "bg-current"}`} />
                {recording ? "Stop recording" : recordLabel === "Record" ? "Record this meeting" : recordLabel}
              </MenuItem>
            )}
            {isHost && <MenuItem onClick={fromMore(onMuteAll)}><MicOffIcon /> Mute everyone</MenuItem>}
            {/* Not through fromMore: the menu stays open long enough to say
                whether the copy worked. */}
            <MenuItem onClick={() => void copyLink()}>
              <LinkIcon /> {linkCopied === true ? "Link copied" : linkCopied === false ? "Couldn't copy — try again" : "Copy invite link"}
            </MenuItem>
          </FloatingMenu>
        </BarGroup>

        {/* Leave / End — always visible. Disabled once pressed: ending posts a
            transcript to a model, and a second press would post a second report.

            The host gets both exits. "End for all" stays the primary press, so
            the muscle memory of every host who has used this room still does what
            it always did; leaving without ending is the deliberate one, behind
            the chevron. */}
        <div className="pl-0.5 sm:pl-2">
          {isHost ? (
            <HostExitControl leaving={leaving} waitingCount={waitingCount} onLeave={onLeave} onEndForAll={onEndForAll} />
          ) : (
            <button onClick={onLeave} disabled={leaving} aria-busy={leaving}
              aria-label={exitLabel(leaving ? "ending" : "live", false)}
              className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap rounded-full bg-[var(--status-danger)] hover:bg-red-600 disabled:opacity-60 disabled:cursor-wait text-white text-sm font-medium px-3.5 lg:px-5 h-11 sm:h-10 transition-colors">
              <PhoneOffIcon /> <span className="hidden lg:inline">{exitLabel(leaving ? "ending" : "live", false)}</span>
            </button>
          )}
        </div>
      </div>

      {/* Right: the link to bring someone else in, where there is room for it.
          The empty column balances the left one, so the controls sit in the
          middle of the screen rather than the middle of what is left. */}
      <div className="hidden 2xl:flex items-center justify-end shrink-0 2xl:w-56">
        <MeetingShareLink roomCode={roomCode} compact />
      </div>
    </div>
  );
}

/** A run of related controls, set apart from the next run by a hairline. */
/**
 * What a breakpoint alone does with each foldable control, and its mirror inside
 * More. This is the FLOOR under the measured fold, not a leftover of it.
 *
 * The measurement runs in a layout effect, so it has not happened for markup
 * rendered on the server, and it never happens at all with JavaScript disabled.
 * With these classes gone the server's bar offered everything, and a real browser
 * said so: Chromium puts seven of a host's controls past the right edge of a
 * 360px window, mic and camera off the left, and the page scrolling sideways —
 * for as long as it takes the bundle to arrive. The breakpoints answer at the
 * first paint and need nothing to run; the measurement refines them a frame later
 * with the one thing they cannot know, which is how much room is actually left.
 *
 * `bar` is the class on the control's own button, `more` the mirror on its twin
 * inside the menu, and they are exact opposites — so at any width exactly one of
 * the two is showing, which is the same guarantee the pair gave before, now with
 * the fold able to take the button away at a width CSS would have kept it.
 *
 * `chat` and `people` were never gated by width and still are not: their mirror is
 * `hidden`, which shows only when the fold has taken their button away.
 */
const BAR_AT_WIDTH: Record<BarFeature, { bar: string; more: string }> = {
  background: { bar: "hidden md:flex", more: "md:hidden" },
  share: { bar: "hidden sm:flex", more: "sm:hidden" },
  hand: { bar: "hidden sm:flex", more: "sm:hidden" },
  react: { bar: "hidden md:flex", more: "md:hidden" },
  layout: { bar: "hidden lg:flex", more: "lg:hidden" },
  record: { bar: "hidden sm:flex", more: "sm:hidden" },
  chat: { bar: "flex", more: "hidden" },
  people: { bar: "flex", more: "hidden" },
  docs: { bar: "hidden md:flex", more: "md:hidden" },
};

function BarGroup({ children, className = "flex" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`${className} items-center gap-1 sm:gap-1.5 xl:pl-1.5 xl:border-l xl:border-[var(--line)] xl:first:border-l-0 xl:first:pl-0`}>
      {children}
    </div>
  );
}

const BAR_TONE = {
  default: "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] hover:bg-[var(--surface-3)]",
  off: "border-status-danger/40 bg-status-danger/10 text-[var(--status-danger)]",
  on: "border-gold-400/60 bg-gold-400/10 text-[var(--gold-400)]",
  recording: "border-[var(--status-danger)] bg-red-500/10 text-[var(--status-danger)]",
} as const;

/**
 * One control on the bar: an icon, and a word under it from `xl` up — below
 * that the row of labelled controls is wider than the screen.
 *
 * 44px tall on a phone — the height a thumb can find without looking, and
 * 42px wide, which is what lets a host's whole bar fit a 360px screen — and
 * 40px where there is a pointer. The words are what the old bar lacked: a row
 * of eleven unlabelled circles, two of them emoji, asked a first-time guest to
 * hover over each one to find the chat.
 */
function BarBtn({
  icon, label, onClick, title, ariaLabel, tone = "default", badge = null, badgeTone = "gold", badgeClassName = "", hint = null,
  pressed, busy = false, disabled = false, btnRef, className = "flex", haspopup = false, expanded,
  dataFeature,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  title: string;
  /** Defaults to the label, which is only a string for most controls. */
  ariaLabel?: string;
  tone?: keyof typeof BAR_TONE;
  badge?: number | null;
  badgeTone?: "gold" | "success";
  badgeClassName?: string;
  /** A quiet number beside the label, such as a headcount. Not a badge. */
  hint?: number | null;
  pressed?: boolean;
  /** A device being opened. Opening one takes a moment, and longer when the
   *  first camera tried is held by something else — without this the press
   *  looks like it did nothing and gets pressed again. */
  busy?: boolean;
  disabled?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>;
  className?: string;
  haspopup?: boolean;
  expanded?: boolean;
  /** Marks a control the bar is allowed to fold. Read by the measurement. */
  dataFeature?: string;
}) {
  return (
    <button
      ref={btnRef}
      type="button"
      data-bar-feature={dataFeature}
      onClick={onClick}
      title={busy ? "Starting…" : title}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : title)}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      aria-haspopup={haspopup ? "menu" : undefined}
      aria-expanded={haspopup ? expanded : undefined}
      disabled={busy || disabled}
      className={`${className} relative shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border w-[42px] h-11 sm:w-10 sm:h-10 xl:w-auto xl:min-w-[3.25rem] xl:h-12 xl:px-1.5 transition-colors disabled:opacity-60 ${
        busy ? "animate-pulse cursor-wait" : disabled ? "cursor-wait" : ""
      } ${BAR_TONE[tone]}`}
    >
      <span aria-hidden="true" className="flex items-center justify-center h-4">{icon}</span>
      <span aria-hidden="true" className="hidden xl:flex items-center gap-1 text-[10px] font-medium leading-none whitespace-nowrap tabular-nums">
        {label}
        {hint !== null && <span className="text-[var(--fg-muted)]">{hint}</span>}
      </span>
      {badge !== null && (
        <span
          aria-hidden="true"
          className={`${badgeClassName} absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-white text-[11px] font-bold flex items-center justify-center ${
            badgeTone === "success" ? "bg-[var(--status-success)]" : "bg-[var(--gold-400)]"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function MenuItem({ children, onClick, className = "", disabled = false, dataFeature, dataFold }: {
  children: React.ReactNode; onClick: () => void; className?: string; disabled?: boolean;
  /** Which foldable control this is a twin of, for the measurement and for tests. */
  dataFeature?: string;
  /** "folded" when the bar gave this control up, "mirror" when the bar still has it. */
  dataFold?: string;
}) {
  return (
    <button role="menuitem" type="button" onClick={onClick} disabled={disabled}
      data-bar-feature={dataFeature} data-fold={dataFold}
      className={`${className} w-full flex items-center gap-2.5 text-left px-2.5 min-h-11 sm:min-h-9 rounded-lg text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-3)] disabled:opacity-60 disabled:cursor-wait transition-colors`}>
      {children}
    </button>
  );
}

function ReactionRow({ onReaction }: { onReaction: (emoji: string) => void }) {
  return (
    <div className="flex gap-1">
      {REACTIONS.map((emoji) => (
        <button key={emoji} type="button" onClick={() => onReaction(emoji)} aria-label={`Send ${emoji}`}
          className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center text-xl rounded-lg hover:bg-[var(--surface-3)] transition-colors">
          {emoji}
        </button>
      ))}
    </div>
  );
}

// ─── CopilotSidebar ───────────────────────────────────────────────────────────

/**
 * The in-call sidebar: chat and people, and nothing else.
 *
 * It used to carry five more tabs — a live transcript, rolling notes, extracted
 * action items, a host walkthrough script, and a paste-a-transcript analyser.
 * Every one of them was something to read while another person was talking to
 * you, and the three that were not free cost a model call every fifteen seconds
 * to produce a rougher version of what the end-of-meeting report generates
 * anyway, from the whole conversation rather than a rolling window.
 *
 * Transcription did not stop; it lost its tab. It still runs, still attributes
 * each line to whoever actually spoke, and still saves — the report afterwards
 * is built from it, and the "Live" lamp in this header is how someone knows it
 * is working.
 */
/**
 * One person's turn in the chat.
 *
 * Module scope and memoized, and both halves matter. The room re-renders
 * several times a second for the whole call — the voice meter samples every
 * 120ms and `speaking` changes at every pause in conversation — and without
 * this every message in the log was rebuilt on each one, re-parsing its text
 * for links to produce the same nodes again.
 *
 * `turn` is safe to compare by identity: `groupChat` is memoized on the
 * messages, so the turn objects only change when the chat does. `onRetry` has
 * to be stable or the comparison never holds — see the stable handlers below.
 *
 * Declared out here rather than inside the sidebar because a component defined
 * during a render is a NEW type on every render, which remounts the subtree and
 * makes the memo worse than useless.
 */
const ChatTurnRow = memo(function ChatTurnRow({
  turn, onRetry,
}: {
  turn: ChatTurn;
  onRetry: (id: string) => void;
}) {
  return (
    // `min-w-0` and `break-words` together are what stop a pasted URL — the
    // most common thing anybody pastes into a meeting chat — from forcing this
    // column wider than the panel, which only scrolls vertically.
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-[var(--gold-400)] break-words">{turn.displayName}</span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--fg-muted)]">
          {chatClock(turn.ts)}
        </span>
      </span>
      {turn.messages.map((msg) => (
        <div key={msg.id} className="flex flex-col gap-0.5 min-w-0">
          <div className="rounded-lg bg-[var(--surface-0)] border border-[var(--line)] px-3 py-2 text-sm text-[var(--fg-primary)] break-words whitespace-pre-wrap">
            <ChatText text={msg.text} />
          </div>
          {msg.delivery === "sending" && (
            <span className="text-[10px] text-[var(--fg-muted)]">Sending…</span>
          )}
          {msg.delivery === "failed" && (
            <span className="text-[10px] text-[var(--status-danger)] flex items-center gap-1.5">
              Not delivered
              <button onClick={() => onRetry(msg.id)} className="underline hover:no-underline font-semibold">
                Retry
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
});

/**
 * One person in the "In this call" list.
 *
 * Takes the flags rather than the participant object, so the comparison does
 * not depend on whether the caller rebuilt its array this render — and so a
 * speaking change re-renders the one row whose dot moved instead of all of
 * them.
 *
 * The dot now arrives by subscription rather than as a prop, which is what stops
 * the panel above being rebuilt to deliver it: on the chat tab this list is not
 * even mounted, and it was still costing a render of the whole sidebar three
 * times a second. The `speaking` prop remains the answer when nobody provides a
 * store, which is how this list renders on its own in CallParts.sidebar.test.tsx.
 */
const PersonRow = memo(function PersonRow({
  id, displayName, micOn, isLocal, speaking, handRaised, color, isHost, onKick,
}: {
  id: string;
  displayName: string;
  micOn: boolean;
  isLocal: boolean;
  /** Used when no speaking store is provided, as the sidebar's own tests do. */
  speaking: boolean;
  handRaised: boolean;
  color: string;
  isHost: boolean;
  onKick: (id: string) => void;
}) {
  const isSpeaking = useSpeaking(id, speaking);
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
      <div
        className={`w-7 h-7 rounded-full bg-gold-400/20 flex items-center justify-center text-xs font-semibold transition-colors ${isSpeaking ? "border-2" : "border border-gold-400/30"}`}
        style={isSpeaking ? { borderColor: color, color } : { color: "var(--gold-400)" }}
      >
        {displayName.slice(0, 1).toUpperCase()}
      </div>
      <span className="text-sm text-[var(--fg-primary)] flex-1">{displayName}</span>
      {/* Muted vs. merely quiet is the difference between "they chose not to
          speak" and "nothing they say is reaching the transcript" — worth
          stating, not leaving to inference. */}
      <span
        title={micOn ? (isSpeaking ? "Speaking now" : "Mic live") : "Muted — not being transcribed"}
        className={`text-xs ${micOn ? (isSpeaking ? "" : "text-[var(--fg-muted)]") : "text-[var(--status-danger)]"}`}
        style={micOn && isSpeaking ? { color } : undefined}
      >
        {micOn ? (isSpeaking ? "◉ speaking" : "mic on") : "muted"}
      </span>
      {handRaised && <span className="text-sm">✋</span>}
      {isLocal ? (
        <span className="text-xs text-[var(--fg-muted)]">You</span>
      ) : isHost ? (
        <button onClick={() => onKick(id)} className="text-xs text-[var(--status-danger)] hover:underline">Remove</button>
      ) : null}
    </div>
  );
});

/** The side panel's tabs. Each has its own button on the control bar. */
export type PanelTab = "chat" | "people" | "docs";

const PANEL_TITLE: Record<PanelTab, string> = { chat: "Chat", people: "People", docs: "Documents" };

// Exported for the tests, exactly as HostExitControl is: reaching this panel
// through MeetingRoom means entering a room, which opens a camera, an ICE
// negotiation and a Realtime channel, and a test that mocked all of that would
// be testing its own mocks.
export function CopilotSidebar({
  srStatus, srNoisy = false, participants, roomCode, meetingTitle,
  chatMessages, chatUnread, onSendChat, onRetryChat, isHost, raisedHands, onKick, onAdmit, onDeny, onAdmitAll, waitingPeers, onChatVisibility,
  meetingId = null, canShareDocs = false,
  removedPeople, onAllowBack,
  speaking = NOBODY, onCollapse,
  tab: tabProp, onTabChange,
}: {
  /**
   * Which tab is showing, when the room decides. The control bar has its own
   * Chat, People and Docs buttons, so the room has to be able to open this
   * panel on any one of them; left out, the panel keeps its own tab, which is
   * how its tests render it.
   */
  tab?: PanelTab;
  onTabChange?: (tab: PanelTab) => void;
  srStatus: "idle" | "active" | "error" | "unsupported";
  /**
   * The recogniser has been hearing mostly noise: the engine itself scores a
   * run of what it heard below even odds. Nearly always the wrong microphone --
   * a phone on a desk, a headset on the wrong input -- and worth saying while
   * the meeting is still going, which is the only time it can be fixed.
   */
  srNoisy?: boolean;
  participants: { id: string; displayName: string; micOn: boolean; isLocal: boolean }[];
  /** Ids of everyone whose voice is in the room right now. */
  /**
   * Only a fallback now. The room provides a speaking store instead, which the
   * rows below subscribe to individually — passing the set down here meant this
   * whole panel re-rendered three times a second to deliver a dot, and on the
   * chat tab the list that draws it is not even mounted. Still accepted so the
   * panel renders on its own with a plain set, as its own tests do.
   */
  speaking?: ReadonlySet<string>;
  roomCode: string; meetingTitle: string; chatMessages: ChatMessage[];
  /** Messages that have arrived since the panel last showed the chat tab. */
  chatUnread: number;
  onSendChat: (text: string) => void;
  /** Send a message again after the socket refused it. */
  onRetryChat: (id: string) => void;
  isHost: boolean;
  raisedHands: Set<string>; onKick: (id: string) => void;
  onAdmit: (id: string) => void; onDeny: (id: string) => void; onAdmitAll: () => void;
  waitingPeers: WaitingPeer[];
  /** Host only. Who has been removed, so the host can undo it. */
  removedPeople: RemovedPerson[];
  onAllowBack: (subject: RemovalSubject) => void;
  /** Whether the chat is the tab being looked at — true on it, false off it. */
  onChatVisibility: (visible: boolean) => void;
  /** Collapse the panel. The only way out on mobile, where it covers the screen. */
  onCollapse: () => void;
  /**
   * The meeting's row id, for the documents tab. Null until the room has
   * resolved it, and on the standalone renders this panel's own tests do.
   */
  meetingId?: string | null;
  /**
   * Whether to offer the data-room tab at all.
   *
   * False for a guest: there is no firm behind them to share from, and a tab
   * that only ever says so is worse than no tab. True for anyone signed in --
   * including a signed-in participant from another firm, because the room
   * cannot tell membership apart from attendance. The route refuses them and
   * the panel says why, which is the honest version of a check the client is
   * not in a position to make.
   */
  canShareDocs?: boolean;
}) {
  const [ownTab, setOwnTab] = useState<PanelTab>("chat");
  const tab = tabProp ?? ownTab;
  const setTab = (t: PanelTab) => { setOwnTab(t); onTabChange?.(t); };
  const [chatInput, setChatInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailNote, setEmailNote] = useState<"sent" | "failed" | null>(null);

  useEffect(() => { if (tab === "chat") chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, tab]);
  // Reported both ways round. Reporting only "the chat is open" is what let
  // messages arriving while somebody read the People tab count as read.
  useEffect(() => { onChatVisibility(tab === "chat"); }, [tab, onChatVisibility]);

  // Colour by id, not by position in the list — so a speaker keeps their colour
  // when someone above them leaves, and holds the same one on every screen.
  const colorFor = (speakerId: string) => SPEAKER_COLORS[speakerColorIndex(speakerId, SPEAKER_COLORS.length)];
  // Regrouped when the messages change, not every time the room re-renders —
  // which, with someone talking, is several times a second.
  const chatTurns = useMemo(() => groupChat(chatMessages), [chatMessages]);

  // The handlers the memoized rows below receive. The room passes these as
  // inline arrows, so they are new functions on every render and comparing them
  // would fail every time — which is the whole memo. Wrapped here rather than at
  // the call site so the rows hold whatever the caller does with its own props.
  const rowHandlers = useStableHandlers({ onRetryChat, onKick });

  // Sorted when the hands or the people change, not on the fast path.
  const orderedPeople = useMemo(() => handsFirst(participants, raisedHands), [participants, raisedHands]);

  // The tab strip. A guest gets two tabs, a member three -- see canShareDocs.
  const tabs = useMemo(
    () => (canShareDocs ? (["chat", "people", "docs"] as const) : (["chat", "people"] as const)),
    [canShareDocs],
  );

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
    setEmailNote(null);
    // The fetch must not be allowed to throw out of here: the callers are
    // `void sendEmailInvites()`, so a rejected request — offline, connection
    // dropped mid-call — skipped everything below and left the button stuck
    // on "…" for the rest of the meeting.
    let ok = false;
    try {
      const res = await fetch("/api/meetings/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, emails, meetingTitle }),
      });
      ok = res.ok;
    } catch {
      // Reported below with the HTTP failures; there is nothing else in `res`
      // this box would say differently.
    }
    setEmailSending(false);
    setEmailNote(ok ? "sent" : "failed");
    if (ok) {
      // Success clears the field and is a receipt, so it withdraws itself. A
      // failure keeps the addresses — they are what to try again with — and
      // stays up until the next attempt: a button that quietly went back to
      // "Send" read as sent.
      setEmailInput("");
      setTimeout(() => setEmailNote(null), 3000);
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-[var(--line)] bg-[var(--surface-1)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)] shrink-0">
        {/* Named for what is showing. It was "✨ Copilot", which described
            none of the three tabs — and "Copilot" in a meeting reads as the AI
            listening in, which is a different thing (the Live lamp beside it). */}
        <h2 className="text-sm font-medium text-[var(--fg-primary)]">{PANEL_TITLE[tab]}</h2>
        <div className="flex items-center gap-1.5">
          {srStatus === "active" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-success)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-pulse" /> Live
            </span>
          )}
          {srStatus === "active" && srNoisy && (
            <span
              className="text-xs text-[var(--status-warning,#f59e0b)]"
              title="Speech recognition is hearing mostly noise. Check which microphone is selected (the arrow beside the mic button) — and that it is also your computer's default microphone, which is the one some browsers transcribe from."
            >
              ⚠ Unclear audio
            </span>
          )}
          {srStatus === "error" && <span className="text-xs text-[var(--status-danger)]">⚠ Mic</span>}
          {srStatus === "unsupported" && <span className="text-xs text-[var(--fg-muted)]">No STT</span>}
          <button
            onClick={onCollapse}
            title="Close panel"
            aria-label="Close panel"
            className="ml-0.5 w-7 h-7 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-2)] flex items-center justify-center transition-colors"
          >
            <CollapseIcon />
          </button>
        </div>
      </div>

      {/* Tabs. overflow-y pinned and no -mb-px on the active tab: otherwise
          the 1px overhang makes this an accidental vertical scroller that
          traps wheel scrolling (same fix as HubTabs). */}
      <div className="flex border-b border-[var(--line)] shrink-0 overflow-x-auto overflow-y-hidden">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`relative shrink-0 flex-1 py-2 text-xs font-medium transition-colors capitalize ${
              tab === t ? "text-[var(--fg-primary)] border-b-2 border-[var(--gold-400)]"
                        : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
            }`}>
            {t === "people" ? `People ${participants.length}` : t === "docs" ? "Docs" : "Chat"}
            {/* The only place an unread count can appear while the panel is
                open: the toolbar badge is suppressed for exactly that case. */}
            {t === "chat" && tab !== "chat" && chatUnread > 0 && (
              <span
                title={`${chatUnread} unread`}
                className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-1 rounded-full bg-[var(--gold-400)] text-white text-[10px] font-bold flex items-center justify-center"
              >
                {chatUnread}
              </span>
            )}
            {t === "people" && isHost && waitingPeers.length > 0 && (
              <span
                title={`${waitingPeers.length} waiting to join`}
                className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-1 rounded-full bg-[var(--status-success)] text-white text-[10px] font-bold flex items-center justify-center"
              >
                {waitingPeers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {tab === "chat" && (
          <>
            {chatMessages.length === 0 ? <EmptyCopilot label="Send a message to everyone in the call." /> : (
              // Grouped: three lines in a row is one person talking, and
              // repeating their name above each is how a short exchange
              // becomes a wall.
              chatTurns.map((turn) => (
                <ChatTurnRow key={turn.id} turn={turn} onRetry={rowHandlers.onRetryChat} />
              ))
            )}
            <div ref={chatBottomRef} />
          </>
        )}

        {tab === "docs" && (
          // Mounted only while the tab is open, so a call where nobody opens it
          // never loads the firm's materials -- and closing the tab drops the
          // list rather than holding it for the rest of the call.
          <MeetingDocsPanel meetingId={meetingId} onShare={onSendChat} />
        )}

        {tab === "people" && (
          <div className="flex flex-col gap-3">
            {/* Waiting room (host only) */}
            {isHost && waitingPeers.length > 0 && (
              <div className="rounded-lg border border-gold-400/40 bg-gold-400/5 p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-[var(--gold-400)] uppercase tracking-wide">
                    Waiting to join{waitingPeers.length > 1 ? ` (${waitingPeers.length})` : ""}
                  </p>
                  {waitingPeers.length > 1 && (
                    <button onClick={onAdmitAll} className="text-xs font-semibold text-[var(--status-success)] hover:underline">Admit all</button>
                  )}
                </div>
                {waitingPeers.map((wp) => (
                  <div key={wp.id} className="flex items-center gap-2">
                    <span className="text-sm text-[var(--fg-primary)] flex-1 truncate">{wp.displayName}</span>
                    <button onClick={() => onAdmit(wp.id)} className="text-xs font-medium text-[var(--status-success)] hover:underline">Admit</button>
                    <button onClick={() => onDeny(wp.id)} className="text-xs font-medium text-[var(--status-danger)] hover:underline">Deny</button>
                  </div>
                ))}
              </div>
            )}

            {/* Invite */}
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 flex flex-col gap-2">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide">Invite people</p>
              <MeetingShareLink roomCode={roomCode} />
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
                  {emailNote === "sent" ? "Sent!" : emailSending ? "…" : emailNote === "failed" ? "Retry" : "Send"}
                </button>
              </div>
              {emailNote === "failed" && (
                <p role="alert" className="text-[11px] text-[var(--status-danger)]">
                  Couldn&apos;t send the invites — check your connection and try again.
                </p>
              )}
              <p className="text-[11px] text-[var(--fg-muted)]">Guests can join without an account</p>
            </div>

            {/* Participant list */}
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide px-1">In this call</p>
              {orderedPeople.map((p) => (
                <PersonRow
                  key={p.id}
                  id={p.id}
                  displayName={p.displayName}
                  micOn={p.micOn}
                  isLocal={p.isLocal}
                  speaking={speaking.has(p.id)}
                  handRaised={raisedHands.has(p.id)}
                  color={colorFor(p.id)}
                  isHost={isHost}
                  onKick={rowHandlers.onKick}
                />
              ))}
            </div>

            {/* Removed — and how to undo it.
                A removal is durable now: it is written down and refused at the
                door, where before it lasted until the person pressed reload. So
                a misclick no longer corrects itself, and this is what stops
                that being a worse trap than the one it replaced. */}
            {isHost && removedPeople.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-[var(--fg-secondary)] uppercase tracking-wide px-1">
                  Removed
                </p>
                {removedPeople.map((r) => (
                  <div key={subjectKey(r.subject)} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                    <div className="w-7 h-7 rounded-full border border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-center text-xs font-semibold text-[var(--fg-muted)]">
                      {r.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="flex-1 truncate text-sm text-[var(--fg-muted)]" title={r.displayName}>
                      {r.displayName}
                    </span>
                    <button
                      onClick={() => onAllowBack(r.subject)}
                      title="They will have to knock again, and you decide"
                      className="text-xs text-[var(--gold-400)] hover:underline"
                    >
                      Allow back
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Chat input */}
      {tab === "chat" && (
        <div className="border-t border-[var(--line)] p-3 flex gap-2 shrink-0">
          <input value={chatInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChatInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            maxLength={CHAT_MAX_LENGTH}
            placeholder="Message everyone…"
            className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]" />
          <button onClick={sendChat} disabled={!chatInput.trim()}
            className="rounded-lg bg-[var(--gold-400)] hover:bg-[var(--gold-500)] disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 transition-colors">
            Send
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Reactions, where they can be seen whatever the layout is doing.
 *
 * The tile overlay is not enough and `hands.ts` already said why: a tile is
 * off-screen in speaker layout or below the fold in a large grid. Hands were
 * given a toolbar count and a spoken label when that was noticed; reactions
 * were not, and they are the worse case — a hand waits to be seen, a reaction
 * is gone in three seconds, and a screen share forces the layout that hides
 * everyone but the presenter.
 *
 * Not a count, which is what the hands affordance is: a reaction is an event,
 * not a standing state, so this shows each one with the name attached and lets
 * it expire. Anchored over the stage rather than in the control bar so it does
 * not move the controls around as reactions come and go.
 *
 * `aria-live="polite"` is the other half of the fix. The tile overlay is a bare
 * emoji with no text, so a screen reader had nothing to announce and reactions
 * did not exist at all for anyone not looking at the picture.
 *
 * Exported for the tests, as HostExitControl and CopilotSidebar are: reaching
 * it through MeetingRoom means entering a room, which opens a camera, an ICE
 * negotiation and a Realtime channel.
 */
export function ReactionTicker({ entries }: { entries: readonly ActiveReaction[] }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Reactions"
      className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-2 rounded-full bg-black/70 backdrop-blur-sm px-3 py-1 text-sm text-white max-w-[70vw]"
        >
          {/* The emoji is decorative here — reactionLabel carries it in text,
              and announcing both would read it twice. */}
          <span aria-hidden="true" className="text-base leading-none">{entry.emoji}</span>
          <span className="sr-only">{reactionLabel(entry)}</span>
          <span aria-hidden="true" className="truncate">{entry.displayName}</span>
        </div>
      ))}
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

// Points the way the panel goes: right on desktop (off to the side), and it
// reads as "dismiss" on the mobile sheet too.
// A portrait against a patterned field — the effect it turns on, not a camera.
function BackgroundIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 20a5.5 5.5 0 0 1 11 0" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 5l7 7-7 7" />
      <path d="M5 5v14" />
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
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function DocsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
export { audioTrackOf, videoTrackOf } from "./room-shared";
