"use client";

// The call screen's own pieces — tiles, control bar, sidebar, menus — split out
// of MeetingRoom so they load as their own chunk, fetched while the member is
// still in the green room rather than before it can be drawn.

import { FloatingMenu, useSpeaking, useStableHandlers, type RemovedPerson } from "./room-shared";
import React, { memo, useEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
import { handsFirst } from "@/lib/meetings/hands";
import { mirrorSelfView } from "@/lib/meetings/stage";
import { REACTIONS, reactionLabel, type ActiveReaction } from "@/lib/meetings/reactions";
import { ChatText } from "./ChatText";
import { speakerColorIndex } from "@/lib/meetings/speaker-attribution";
import { CHAT_MAX_LENGTH, chatClock, groupChat, type ChatMessage, type ChatTurn } from "@/lib/meetings/chat";
import { MeetingShareLink } from "@/app/(app)/meetings/MeetingShareLink";
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
function PeerAudioImpl({ stream, audioTrack }: {
  stream: MediaStream | null;
  audioTrack: MediaStreamTrack | null;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = false;
    const source = audioTrack ? stream : null;
    if (el.srcObject !== source) el.srcObject = source;
    if (!source) return;
    const play = () => { void el.play()?.catch(() => { /* retried below */ }); };
    play();
    // Autoplay with sound can be refused until the page has been interacted
    // with. Joining is a click, so this is rare, but a voice that silently never
    // starts is the worst failure a call has: try again on the next gesture.
    document.addEventListener("pointerdown", play, { once: true });
    document.addEventListener("keydown", play, { once: true });
    return () => {
      document.removeEventListener("pointerdown", play);
      document.removeEventListener("keydown", play);
    };
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
        className="flex items-center justify-center w-4 h-4 text-[var(--fg-muted)] hover:text-[var(--fg-primary)] transition-colors">
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

// ─── CtrlBtn ──────────────────────────────────────────────────────────────────

function CtrlBtn({ active, onClick, title, activeIcon, inactiveIcon, busy = false }: {
  active: boolean; onClick: () => void; title: string; activeIcon: React.ReactNode; inactiveIcon: React.ReactNode;
  /** A device being opened. Opening one takes a moment, and longer when the
   *  first camera tried is held by something else — without this the press
   *  looks like it did nothing and gets pressed again. */
  busy?: boolean;
}) {
  return (
    <button onClick={onClick} title={busy ? "Starting…" : title} disabled={busy} aria-busy={busy}
      className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
        busy ? "animate-pulse cursor-wait" : ""
      } ${
        active ? "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] hover:bg-[var(--surface-3)]"
               : "border-status-danger/40 bg-status-danger/10 text-[var(--status-danger)]"
      }`}>
      {active ? activeIcon : inactiveIcon}
    </button>
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
      {/* The label is the button's only text and it is display:none below `sm`,
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
        className="flex items-center gap-1.5 sm:gap-2 rounded-l-full rounded-r-none bg-[var(--status-danger)] hover:bg-red-600 disabled:opacity-60 disabled:cursor-wait text-white text-sm font-medium pl-3 sm:pl-5 pr-2 sm:pr-3 py-2 transition-colors">
        <PhoneOffIcon /> <span className="hidden sm:inline">{exitLabel(leaving ? "ending" : "live", true)}</span>
      </button>
      {/* A hairline, so the two halves read as two actions rather than one wide
          button that happens to have an arrow on it. */}
      <span aria-hidden="true" className="w-px self-stretch bg-white/25" />
      <button ref={chevronRef} onClick={() => setOpen((v: boolean) => !v)} disabled={leaving}
        aria-label="Other ways to leave" aria-haspopup="menu" aria-expanded={open}
        className="flex items-center justify-center rounded-r-full rounded-l-none bg-[var(--status-danger)] hover:bg-red-600 disabled:opacity-60 disabled:cursor-wait text-white pl-1.5 pr-2.5 sm:pr-3 py-2 self-stretch transition-colors">
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

function ControlBarImpl({
  micOn, camOn, shareOn, shareStarting, copilotOpen, isHost, handRaised, handsUp, handsUpNote, layout, layoutForced, chatUnread, waitingCount, elapsed, roomCode, bwMode,
  onToggleMic, onToggleCam, onToggleScreen, onToggleCopilot, onLeave, onEndForAll,
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
  micOn: boolean; camOn: boolean; shareOn: boolean; shareStarting: boolean; copilotOpen: boolean; isHost: boolean;
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
  onToggleCopilot: () => void; onLeave: () => void; onEndForAll: () => void;
  onSwitchMic: (id: string) => void; onSwitchCam: (id: string) => void; onSwitchSpeaker: (id: string) => void;
  /** The devices the call is actually running on, so the pickers can say so. */
  activeMicId: string; activeCamId: string;
  camStarting: boolean;
  onRaiseHand: () => void; onReaction: (emoji: string) => void; onMuteAll: () => void; onToggleLayout: () => void;
  onFlipCamera: () => void;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const reactionBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex items-center justify-between px-3 sm:px-6 py-3 border-t border-[var(--line)] bg-[var(--surface-1)] shrink-0 gap-2">
      {/* Timer — hidden on very small screens to save space */}
      <MeetingClock elapsed={elapsed} className="hidden sm:block text-xs font-mono text-[var(--fg-muted)] tabular-nums w-16 shrink-0" />

      <div className="flex items-center gap-1.5 sm:gap-2 flex-1 justify-center">
        {/* Core controls — always visible */}
        <div className="flex items-center gap-0.5">
          <CtrlBtn active={micOn} onClick={onToggleMic} title={micOn ? "Mute" : "Unmute"} activeIcon={<MicIcon />} inactiveIcon={<MicOffIcon />} />
          <span className="hidden sm:block"><DeviceChevron kind="audioinput" activeId={activeMicId} onSelect={onSwitchMic} /></span>
        </div>
        <div className="flex items-center gap-0.5">
          <CtrlBtn active={camOn} onClick={onToggleCam} busy={camStarting} title={camOn ? "Camera off" : "Camera on"} activeIcon={<CamIcon />} inactiveIcon={<CamOffIcon />} />
          <span className="hidden sm:block"><DeviceChevron kind="videoinput" activeId={activeCamId} onSelect={onSwitchCam} /></span>
        </div>

        {/* Backgrounds — next to the camera controls, because that is what it
            changes. On phones too: segmentation there costs battery, but the
            auto-downgrade already pulls the effect when frames fall behind, and
            a phone is exactly where someone is most likely to want their room
            hidden. */}
        <span>
          <button
            ref={backgroundBtnRef}
            onClick={onOpenBackgrounds}
            title="Background effects"
            aria-label="Background effects"
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${
              backgroundActive
                ? "border-gold-400/60 bg-gold-400/10 text-[var(--gold-400)]"
                : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-3)]"
            }`}
          >
            <BackgroundIcon />
          </button>
        </span>

        {/* Camera flip — mobile only */}
        <button onClick={onFlipCamera} title="Flip camera"
          className="sm:hidden w-10 h-10 rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-3)] flex items-center justify-center text-base transition-colors">
          🔄
        </button>

        {/* Screen share — hidden on mobile (not practical) */}
        <span className="hidden sm:block">
          <CtrlBtn active={shareOn} onClick={onToggleScreen} busy={shareStarting} title={shareOn ? "Stop sharing" : "Share screen"} activeIcon={<ScreenShareIcon />} inactiveIcon={<ScreenShareIcon />} />
        </span>

        {/* Raise hand — and the badge that says somebody else has. */}
        <button onClick={onRaiseHand}
          title={handsUpNote || (handRaised ? "Lower hand" : "Raise hand")}
          aria-label={handsUpNote ? `${handRaised ? "Lower hand" : "Raise hand"}. ${handsUpNote}.` : (handRaised ? "Lower hand" : "Raise hand")}
          className={`relative w-10 h-10 rounded-full border flex items-center justify-center text-base transition-colors ${
            handRaised ? "border-gold-400/60 bg-gold-400/10 text-[var(--gold-400)]"
                       : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] hover:bg-[var(--surface-3)]"
          }`}>
          ✋
          {handsUp > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[var(--gold-400)] text-white text-[11px] font-bold flex items-center justify-center">
              {handsUp}
            </span>
          )}
        </button>

        {/* Reactions */}
        <button ref={reactionBtnRef} onClick={() => setReactionOpen((v: boolean) => !v)} title="Send reaction"
          className="w-10 h-10 rounded-full border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] flex items-center justify-center text-base transition-colors">
          😊
        </button>
        <FloatingMenu open={reactionOpen} anchorRef={reactionBtnRef} onClose={() => setReactionOpen(false)} minWidth={0}>
          <div className="flex gap-1">
            {REACTIONS.map((emoji) => (
              <button key={emoji} onClick={() => { onReaction(emoji); setReactionOpen(false); }}
                className="w-8 h-8 flex items-center justify-center text-xl rounded-lg hover:bg-[var(--surface-3)] transition-colors">
                {emoji}
              </button>
            ))}
          </div>
        </FloatingMenu>

        {/* Layout toggle — hidden on mobile */}
        <span className="hidden sm:block">
          <button onClick={onToggleLayout}
            title={layoutForced
              ? "Someone is sharing their screen — grid view resumes when they stop"
              : layout === "grid" ? "Speaker view" : "Grid view"}
            className="w-10 h-10 rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-3)] flex items-center justify-center transition-colors">
            {layout === "grid" ? <SpeakerViewIcon /> : <GridViewIcon />}
          </button>
        </span>

        {/* Record — host only. Deliberately NOT hidden on mobile like the two
            controls either side: a host running the meeting from a phone is
            exactly the host most likely to want a recording of it. */}
        {isHost && (
          <button
            onClick={onToggleRecording}
            disabled={recordingState === "starting" || recordingState === "stopping"}
            aria-pressed={recordingState === "recording"}
            title={recordingState === "recording" ? "Stop recording" : "Record this meeting"}
            className={`flex items-center gap-1.5 rounded-full border px-3 h-10 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-wait ${
              recordingState === "recording"
                ? "border-[var(--status-danger)] bg-red-500/10 text-[var(--status-danger)]"
                : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${
              recordingState === "recording" ? "bg-[var(--status-danger)] animate-pulse" : "bg-current"
            }`} />
            <span className="hidden sm:inline">
              {recordingState === "recording"
                ? <>Stop · {recordingStartedAt !== null ? <RecordingClock startedAt={recordingStartedAt} /> : formatElapsed(0)}</>
                : recordingState === "starting" ? "Starting…"
                : recordingState === "stopping" ? "Saving…"
                : "Record"}
            </span>
          </button>
        )}

        {/* Mute all — host only, hidden on mobile */}
        {isHost && (
          <span className="hidden sm:block">
            <button onClick={onMuteAll} title="Mute all participants"
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)] px-3 h-10 text-xs font-medium transition-colors">
              Mute all
            </button>
          </span>
        )}

        {/* Leave / End — always visible. Disabled once pressed: ending posts a
            transcript to a model, and a second press would post a second report.

            The host gets both exits. "End for all" stays the primary press, so
            the muscle memory of every host who has used this room still does what
            it always did; leaving without ending is the deliberate one, behind
            the chevron. */}
        {isHost ? (
          <HostExitControl leaving={leaving} waitingCount={waitingCount} onLeave={onLeave} onEndForAll={onEndForAll} />
        ) : (
          <button onClick={onLeave} disabled={leaving} aria-busy={leaving}
            aria-label={exitLabel(leaving ? "ending" : "live", false)}
            className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--status-danger)] hover:bg-red-600 disabled:opacity-60 disabled:cursor-wait text-white text-sm font-medium px-3 sm:px-5 py-2 transition-colors">
            <PhoneOffIcon /> <span className="hidden sm:inline">{exitLabel(leaving ? "ending" : "live", false)}</span>
          </button>
        )}
      </div>

      {/* Right side: BW indicator + copy link + copilot toggle */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Seen by EVERY participant, not just the host, and never hidden on a
            small screen. Several US states require every party to a
            conversation to know it is being recorded; a badge that collapses on
            a phone is a badge the guest on a phone never saw. */}
        {recordingState !== "idle" && (
          <span
            title={recordingNotice(recordingState, recordingBy) ?? undefined}
            className="flex items-center gap-1.5 rounded-full border border-[var(--status-danger)] bg-red-500/10 px-2 py-1 text-xs font-medium text-[var(--status-danger)]"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--status-danger)] animate-pulse" />
            <span className="hidden sm:inline">
              {recordingState === "recording" ? "Recording" : recordingState === "stopping" ? "Saving" : "Starting"}
            </span>
          </span>
        )}

        {linkNotice(bwMode) && (
          <span title={linkNotice(bwMode)!} className="text-xs text-[var(--status-warning)] flex items-center gap-1 border border-status-warning/30 rounded-full px-2 py-1">
            📶 <span className="hidden sm:inline">{bwMode === "audio-only" ? "Video paused" : "Reduced quality"}</span>
          </span>
        )}
        <span className="hidden sm:flex"><MeetingShareLink roomCode={roomCode} compact /></span>
        <button onClick={onToggleCopilot}
          className={`relative flex items-center gap-1.5 rounded-full border px-2.5 sm:px-3 py-1.5 text-xs font-medium transition-colors ${
            copilotOpen ? "border-[var(--gold-400)] bg-gold-400/10 text-[var(--gold-400)]"
                        : "border-[var(--line)] text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
          }`}>
          ✨ <span className="hidden sm:inline">Copilot</span>
          {/* Someone waiting outranks unread chat: one is a person held at the
              door, the other is a message that will keep. */}
          {waitingCount > 0 ? (
            <span
              title={`${waitingCount} waiting to join`}
              className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[var(--status-success)] text-white text-[11px] font-bold flex items-center justify-center"
            >
              {waitingCount}
            </span>
          ) : chatUnread > 0 && !copilotOpen ? (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--gold-400)] text-white text-[11px] font-bold flex items-center justify-center">
              {chatUnread}
            </span>
          ) : null}
        </button>
      </div>
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

// Exported for the tests, exactly as HostExitControl is: reaching this panel
// through MeetingRoom means entering a room, which opens a camera, an ICE
// negotiation and a Realtime channel, and a test that mocked all of that would
// be testing its own mocks.
export function CopilotSidebar({
  srStatus, participants, roomCode, meetingTitle,
  chatMessages, chatUnread, onSendChat, onRetryChat, isHost, raisedHands, onKick, onAdmit, onDeny, onAdmitAll, waitingPeers, onChatVisibility,
  meetingId = null, canShareDocs = false,
  removedPeople, onAllowBack,
  speaking = NOBODY, onCollapse,
}: {
  srStatus: "idle" | "active" | "error" | "unsupported";
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
  const [tab, setTab] = useState<"chat" | "people" | "docs">("chat");
  const [chatInput, setChatInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

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
    const res = await fetch("/api/meetings/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode, emails, meetingTitle }),
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
        </div>
        <div className="flex items-center gap-1.5">
          {srStatus === "active" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-success)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-pulse" /> Live
            </span>
          )}
          {srStatus === "error" && <span className="text-xs text-[var(--status-danger)]">⚠ Mic</span>}
          {srStatus === "unsupported" && <span className="text-xs text-[var(--fg-muted)]">No STT</span>}
          <button
            onClick={onCollapse}
            title="Collapse copilot"
            aria-label="Collapse copilot"
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
                  {emailSent ? "Sent!" : emailSending ? "…" : "Send"}
                </button>
              </div>
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
export { audioTrackOf, videoTrackOf } from "./room-shared";
