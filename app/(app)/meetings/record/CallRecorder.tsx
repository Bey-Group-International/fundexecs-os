"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRecording } from "@/lib/meetings/use-recording";
import { OneWayRecorder } from "@/lib/meetings/one-way-recorder";
import type { ComposerHandlers } from "@/lib/meetings/recording-composer";
import {
  NO_SHARED_AUDIO_NOTICE,
  canOfferComputerAudio,
  captureErrorMessage,
} from "@/lib/meetings/audio-capture";
import {
  blockedReason,
  callClock,
  captureLabel,
  captureSources,
  type CaptureSource,
  callTitle,
  defaultCallTitle,
  disclosureScript,
  mayStartRecording,
} from "@/lib/meetings/one-way";
import {
  FLUSH_INTERVAL_MS,
  MAX_BATCH,
  nextBatch,
  pendingLines,
  transcriptRows,
  type BufferableLine,
} from "@/lib/meetings/transcript-buffer";

// Recording a phone call.
//
// The product's meetings are rooms. This is the same record of a conversation
// with the room taken away: somebody is on a call — on their phone, on a
// softphone, on a bridge — and wants a transcript and a report of it
// afterwards. There is no second participant here, no signalling and no
// waiting room, and the session is audio only, because a 720p canvas of
// nothing would cost 675MB an hour to store a picture no one will look at.
//
// Everything after the microphone is shared with meetings on purpose: the same
// part upload with its retries, the same recording rows, the same transcript
// rows, the same report. What is special is the front of it — consent, and
// what is being captured.

type Line = BufferableLine;

/**
 * One settled line of the transcript.
 *
 * Memoised on its text, which is the half `FinishedLines` cannot cover. That
 * memo is keyed on the array, and a new sentence is a new array — so every
 * line already on screen re-rendered with it. Measured at 2,000 lines, one
 * sentence arriving ran 2,066 row bodies; through this it runs 1. A line's
 * text never changes once it is final, so every one of those was work whose
 * output was already on the page.
 *
 * Takes the text rather than the line, so a row cannot be invalidated by a
 * field it does not draw.
 */
const TranscriptLine = memo(function TranscriptLine({ text }: { text: string }) {
  return <li className="px-4 py-2.5 text-sm text-[var(--fg-primary)]">{text}</li>;
});

/**
 * The finished lines of the transcript, re-rendered only when a line is added.
 *
 * The in-progress words update several times a second while anyone speaks, and
 * they used to re-render every finished line with them — thousands of rows by
 * the end of a long call, all re-checked on every word.
 */
const FinishedLines = memo(function FinishedLines({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((line) => (
        <TranscriptLine key={line.id} text={line.text} />
      ))}
    </>
  );
});

/** "failed" is reached only after the audio is safely stored. */
type Phase = "setup" | "recording" | "ending" | "failed";

export function CallRecorder({
  userId,
  userName,
  orgName,
}: {
  userId: string;
  userName: string;
  orgName: string | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [phase, setPhase] = useState<Phase>("setup");
  const [title, setTitle] = useState("");
  const [computerAudio, setComputerAudio] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  /** Words still being recognised — shown, never saved. */
  const [interim, setInterim] = useState("");
  const [meeting, setMeeting] = useState<{ id: string; roomCode: string; title: string } | null>(null);
  /**
   * The name to suggest for a call nobody has titled — read once, on mount.
   *
   * It used to be `defaultCallTitle()` in the placeholder, which re-read the
   * clock on every render: the suggestion moved while the person was typing
   * beside it, and each keystroke built two Intl formatters to produce it.
   */
  const [suggestedTitle] = useState(() => defaultCallTitle());
  /**
   * What is actually being captured, as opposed to what was asked for.
   *
   * A share that was cancelled, or that arrived with no audio track, leaves
   * the checkbox ticked and the computer uncaptured — and a recorder claiming
   * "Microphone and computer audio" while recording only a microphone is the
   * one lie this screen must not tell, because the person believes it and
   * finds out when they play the call back.
   */
  const [captured, setCaptured] = useState<CaptureSource[]>([]);

  const disclosure = useMemo(() => disclosureScript(userName, orgName), [userName, orgName]);
  const sources = useMemo(() => captureSources(computerAudio), [computerAudio]);
  const gate = { acknowledged, disclosure, sources };
  const ready = mayStartRecording(gate);

  // Whether this browser can be asked for the computer's own audio at all.
  // Read once, after mount: it depends on navigator, which the server has not
  // got, and rendering the toggle then removing it would be worse than never
  // offering it.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(canOfferComputerAudio({
      hasDisplayMedia: typeof navigator !== "undefined"
        && typeof navigator.mediaDevices?.getDisplayMedia === "function",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    }));
  }, []);

  // ── Transcript ────────────────────────────────────────────────────────────
  //
  // The same buffer primitives the meeting room uses, through the same route,
  // for the same reason: a line is forgotten only once the server confirms it,
  // so a flush can be retried without duplicating, and a laptop that dies
  // mid-call has already handed over everything up to fifteen seconds ago.
  const linesRef = useRef<Line[]>([]);
  const savedIdsRef = useRef<Set<string>>(new Set());
  const meetingIdRef = useRef<string | null>(null);

  const flushTranscript = useCallback(async (opts: { keepalive?: boolean } = {}): Promise<boolean> => {
    const id = meetingIdRef.current;
    if (!id) return true;
    const pending = pendingLines(linesRef.current, savedIdsRef.current);
    if (!pending.length) return true;
    const batch = nextBatch(pending, MAX_BATCH);
    try {
      const res = await fetch(`/api/meetings/${id}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: transcriptRows(batch, id) }),
        keepalive: opts.keepalive === true,
      });
      if (!res.ok) return false;
      for (const line of batch) savedIdsRef.current.add(line.id);
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Keep flushing until nothing is owed — one flush sends at most MAX_BATCH. */
  const drainTranscript = useCallback(async () => {
    for (let i = 0; i < 40; i++) {
      const owed = pendingLines(linesRef.current, savedIdsRef.current);
      if (!owed.length) return;
      if (!(await flushTranscript())) return;
    }
  }, [flushTranscript]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => { void flushTranscript(); }, FLUSH_INTERVAL_MS);
    // The document going away takes an ordinary fetch with it; keepalive is
    // what gets the last words out of a closing tab.
    const onHide = () => { void flushTranscript({ keepalive: true }); };
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
    };
  }, [phase, flushTranscript]);

  /** Resolves once the recogniser has handed over its last words. Set while recording. */
  const finishRecognitionRef = useRef<(() => Promise<void>) | null>(null);

  /** Speech recognition, running only while the call is being recorded. */
  useEffect(() => {
    if (phase !== "recording") return;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setNotice("This browser cannot transcribe live, so the call is being recorded without a transcript.");
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let stopped = false;
    let startedAt = 0;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let settle: (() => void) | null = null;

    /** Start (or restart) a recognition session, unless the call has ended. */
    const begin = () => {
      restartTimer = null;
      if (stopped) return;
      startedAt = performance.now();
      try { recognition.start(); } catch { /* already going */ }
    };

    recognition.onresult = (ev: SpeechRecognitionEventLike) => {
      let pending = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (!result.isFinal) {
          pending += result[0]?.transcript ?? "";
          continue;
        }
        const text = (result[0]?.transcript ?? "").trim();
        if (!text) continue;
        // Written to the ref in the same tick, not after the next render: the
        // last sentence arrives just after End is pressed, and the drain that
        // follows reads the ref, not the state.
        linesRef.current = [...linesRef.current, {
          id: crypto.randomUUID(),
          // One speaker, and the row wants a signalling id. There is no
          // signalling here, so the account is the identity — which is also
          // what the transcript route stamps speaker_user_id from.
          speakerId: userId,
          speaker: userName,
          userId,
          text,
          ts: Date.now(),
          final: true,
          isLocal: true,
          confidence: typeof result[0]?.confidence === "number" ? result[0].confidence : 1,
          // Nobody to speak over. A one-way call has one microphone.
          overlapped: false,
        }];
        setLines(linesRef.current);
      }
      setInterim(pending.trim());
    };
    // Recognition stops itself on silence, which a phone call has plenty of.
    // Restarting is what keeps the back half of a call transcribed at all —
    // but not instantly when it died instantly: a session that ends within a
    // second of starting is failing, and restarting it at once spins the CPU
    // for the rest of the call.
    recognition.onend = () => {
      if (stopped) { settle?.(); return; }
      const quick = performance.now() - startedAt < SR_MIN_RUN_MS;
      restartTimer = setTimeout(begin, quick ? SR_RETRY_MS : 0);
    };
    recognition.onerror = (ev: unknown) => {
      const code = (ev as { error?: string } | null)?.error ?? "";
      // Permanent refusals. Restarting cannot fix them, so stop trying and say
      // so — the audio is unaffected.
      if (SR_FATAL.has(code)) {
        stopped = true;
        setInterim("");
        setNotice("Live transcription is not available in this browser session; the call is still being recorded.");
      }
    };

    // End asks for this so the words spoken just before it are kept: stop()
    // hands back the last result asynchronously, then fires onend.
    finishRecognitionRef.current = () => new Promise<void>((resolve) => {
      if (stopped) { resolve(); return; }
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      settle = resolve;
      setTimeout(resolve, SR_FINISH_MS);
      try { recognition.stop(); } catch { resolve(); }
    });

    begin();

    return () => {
      stopped = true;
      finishRecognitionRef.current = null;
      if (restartTimer) clearTimeout(restartTimer);
      setInterim("");
      try { recognition.stop(); } catch { /* already stopped */ }
    };
  }, [phase, userName, userId]);

  // Follow the newest words, unless the person has scrolled up to read.
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines, interim]);

  // ── Recording ─────────────────────────────────────────────────────────────

  /** The streams, acquired before the hook starts so failures surface first. */
  const capturedRef = useRef<{ microphone: MediaStream; computer: MediaStream | null } | null>(null);

  const createSource = useCallback((handlers: ComposerHandlers) => {
    const captured = capturedRef.current;
    if (!captured) throw new Error("The microphone was not opened.");
    return new OneWayRecorder(captured, handlers);
  }, []);

  const recorder = useRecording({
    supabase,
    meetingId: meeting?.id ?? null,
    hostName: userName,
    createSource,
    // Audio only. The row's container is corrected the moment the browser
    // chooses one, but it must not claim to hold video in the meantime.
    fallbackMimeType: "audio/webm",
    // Nobody to tell. The announcement exists so a room can show everyone the
    // badge; on a one-way call the only participant is the person pressing the
    // button.
    announce: () => {},
  });

  const start = useCallback(async () => {
    if (!ready) return;
    setError(null);
    setNotice(null);

    let microphone: MediaStream;
    try {
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      // Fatal: the microphone IS the recording. Nothing has been created yet,
      // so there is nothing to clean up and nothing claiming to hold a call.
      setError(captureErrorMessage(err, "microphone"));
      return;
    }

    let computer: MediaStream | null = null;
    if (computerAudio) {
      try {
        // Chrome will not share audio without video, so video is asked for —
        // at one frame a second, since it is stopped the moment it arrives.
        const shared = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: true });
        if (shared.getAudioTracks().length === 0) {
          // The common mistake: the tab was shared with "Also share tab audio"
          // left unticked. Said now, because the alternative is discovering it
          // when the recording is played back and the other side is missing.
          for (const t of shared.getTracks()) t.stop();
          setNotice(NO_SHARED_AUDIO_NOTICE);
        } else {
          // The picture is not wanted and not stored — only the audio track
          // reaches the recorder — so the video track is stopped immediately
          // rather than left running a screen capture for the whole call.
          for (const t of shared.getVideoTracks()) t.stop();
          computer = shared;
        }
      } catch (err) {
        // Not fatal. Cancelling the share dialog is a person saying they do not
        // want it, and ending their call recording over that would throw away
        // the thing they actually asked for.
        setNotice(captureErrorMessage(err, "computer"));
      }
    }

    try {
      const res = await fetch("/api/meetings/one-way", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          disclosure,
          acknowledged,
          // What was actually captured, not what was asked for: a share that
          // produced no audio must not be recorded as consent to capture it.
          computerAudio: computer !== null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string; roomCode?: string; title?: string; error?: string;
      };
      if (!res.ok || !body.id || !body.roomCode) throw new Error(body.error ?? "Could not start the call");

      capturedRef.current = { microphone, computer };
      setCaptured(captureSources(computer !== null));
      meetingIdRef.current = body.id;
      // The name the route settled on, kept rather than worked out again later.
      // It is the one stored on the row, so holding it is what keeps the
      // archive and the report calling this call the same thing. The fallback
      // is the same rule the route applies, evaluated here at the same moment
      // — the start of the call — and not when it ends.
      setMeeting({ id: body.id, roomCode: body.roomCode, title: body.title ?? callTitle(title) });
      setPhase("recording");
    } catch (err) {
      for (const t of microphone.getTracks()) t.stop();
      if (computer) for (const t of computer.getTracks()) t.stop();
      setError(err instanceof Error ? err.message : "Could not start the call");
    }
  }, [ready, computerAudio, title, disclosure, acknowledged]);

  /** Release whatever was opened, so no microphone outlives its recording. */
  const releaseCapture = useCallback(() => {
    const captured = capturedRef.current;
    capturedRef.current = null;
    if (!captured) return;
    for (const stream of [captured.microphone, captured.computer]) {
      if (!stream) continue;
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* already stopped */ }
      }
    }
  }, []);

  // The hook can only start once the meeting id has reached it, which is a
  // render after setMeeting. Started from here rather than inside `start` so
  // it never races that.
  const startedRef = useRef(false);
  useEffect(() => {
    if (phase !== "recording" || !meeting || startedRef.current) return;
    startedRef.current = true;
    void recorder.start().catch(() => {
      // The source threw before it owned anything, so the streams acquired
      // above are still open and nothing else will close them. Released here,
      // and the latch is dropped so the person can actually try again — it
      // used to stay set, which turned one failure into a dead page.
      releaseCapture();
      startedRef.current = false;
      setPhase("setup");
    });
  }, [phase, meeting, recorder, releaseCapture]);

  /**
   * Leaving mid-call must not leave the microphone live.
   *
   * Navigating away unmounts this and takes the UI with it; without this the
   * recorder keeps encoding into a page nobody is looking at, the browser's
   * recording indicator stays on, and the row sits at status='recording' until
   * the sweep closes it hours later. The meeting room has the same guard for
   * the same reason.
   */
  const recorderRef = useRef(recorder);
  useEffect(() => { recorderRef.current = recorder; }, [recorder]);
  useEffect(() => () => {
    recorderRef.current.stop();
    releaseCapture();
  }, [releaseCapture]);

  /**
   * End the call: stop recording, keep the last words, write the report.
   *
   * Waits for the recogniser's final result before draining the transcript,
   * then goes to the report page — or, if the report could not be written,
   * stays here and says the call is saved in the archive.
   */
  const end = useCallback(async () => {
    if (!meeting) return;
    // Asked for before the phase changes, because that change tears the
    // recogniser down — and with it the sentence still being finished.
    const heard = finishRecognitionRef.current?.() ?? Promise.resolve();
    setPhase("ending");
    recorder.stop();
    await heard;
    await drainTranscript();

    const transcript = linesRef.current.map((l) => `${l.speaker}: ${l.text}`).join("\n");
    try {
      const res = await fetch("/api/meetings/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId: meeting.id,
          title: meeting.title,
          participants: [userName],
          transcript,
          duration: recorder.elapsed,
        }),
      });
      if (res.ok) { router.push(`/meetings/${meeting.roomCode}/report`); return; }
      console.warn("[call] report failed", res.status);
    } catch (err) {
      console.warn("[call] report error", err);
    }
    // Deliberately NOT pushed to the report page. The recording and every
    // transcript line that landed are stored either way, but nothing wrote a
    // report row — so that page would sit generating a summary that is not
    // coming. The call is in the archive; say so, and stay put.
    setPhase("failed");
    setError("The call was saved, but its summary could not be written. It is in your recorded calls, where you can try again.");
  }, [meeting, recorder, drainTranscript, userName, router]);

  const blocked = blockedReason(gate);

  if (phase !== "setup") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-6">
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${
                recorder.state === "recording" ? "animate-pulse bg-[var(--status-danger)]" : "bg-[var(--fg-muted)]"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--fg-primary)]">
                {phase === "failed"
                  ? "Saved"
                  : recorder.state === "recording"
                    ? "Recording"
                    : phase === "ending" ? "Finishing…" : "Starting…"}
              </p>
              <p className="text-xs text-[var(--fg-muted)]">{captureLabel(captured)}</p>
            </div>
            <span className="font-mono text-2xl tabular-nums text-[var(--fg-primary)]">
              {callClock(recorder.elapsed)}
            </span>
          </div>

          {(error || recorder.error) && (
            <p className="mt-4 rounded-lg bg-status-danger/10 px-3 py-2 text-xs text-[var(--status-danger)]">
              {error ?? recorder.error}
            </p>
          )}
          {(notice || recorder.notice) && (
            <p className="mt-4 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--fg-secondary)]">
              {notice ?? recorder.notice}
            </p>
          )}

          {phase === "failed" ? (
            <Link
              href="/meetings/calls"
              className="mt-6 block w-full rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-center text-sm font-medium text-[var(--surface-0)]"
            >
              Go to recorded calls
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void end()}
              disabled={phase === "ending"}
              className="mt-6 w-full rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-sm font-medium text-[var(--surface-0)] disabled:opacity-50"
            >
              {phase === "ending" ? "Saving the call…" : "End and summarise"}
            </button>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
          <p className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
            Transcript
          </p>
          {lines.length === 0 && !interim ? (
            <p className="px-4 py-8 text-center text-xs text-[var(--fg-muted)]">
              Words appear here as they are recognised.
            </p>
          ) : (
            <ol
              ref={transcriptRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
              className="max-h-[24rem] divide-y divide-[var(--line)] overflow-y-auto"
            >
              <FinishedLines lines={lines} />
              {interim && (
                <li className="px-4 py-2.5 text-sm italic text-[var(--fg-muted)]">{interim}</li>
              )}
            </ol>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-lg font-semibold text-[var(--fg-primary)]">Record a call</h1>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">
        For a call you are taking somewhere else. Put it on speaker, or share the tab it is running in,
        and you will get a recording, a transcript and a summary afterwards.
      </p>

      <div className="mt-6 space-y-5 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-6">
        <label className="block">
          <span className="text-xs font-medium text-[var(--fg-secondary)]">What is this call?</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={suggestedTitle}
            className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--gold-400)] focus:outline-none"
          />
        </label>

        <div>
          <span className="text-xs font-medium text-[var(--fg-secondary)]">What to capture</span>
          <p className="mt-1.5 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg-primary)]">
            Microphone <span className="text-xs text-[var(--fg-muted)]">— always on, it is the recording</span>
          </p>
          {canShare ? (
            <label className="mt-2 flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={computerAudio}
                onChange={(e) => setComputerAudio(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm text-[var(--fg-primary)]">
                Also capture this computer&rsquo;s audio
                <span className="mt-0.5 block text-xs text-[var(--fg-muted)]">
                  For a call running on this machine. You will be asked to pick the tab or window —
                  tick &ldquo;Also share tab audio&rdquo; or the other side will not be captured.
                </span>
              </span>
            </label>
          ) : (
            <p className="mt-2 text-xs text-[var(--fg-muted)]">
              This browser cannot capture the computer&rsquo;s own audio. Put the call on speakerphone
              and the microphone will pick up both sides.
            </p>
          )}
        </div>

        {/* Consent is asked for before anything is opened, not after. */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-4">
          <p className="text-xs font-medium text-[var(--fg-secondary)]">Read this before you start recording</p>
          <p className="mt-2 text-sm italic text-[var(--fg-primary)]">&ldquo;{disclosure}&rdquo;</p>
          <p className="mt-2 text-xs text-[var(--fg-muted)]">
            Recording laws differ by state and country, and some require everyone on the call to agree.
            This wording and your confirmation are stored with the recording.
          </p>
          <label className="mt-3 flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm text-[var(--fg-primary)]">
              I have consent from everyone on this call to record it.
            </span>
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-status-danger/10 px-3 py-2 text-xs text-[var(--status-danger)]">{error}</p>
        )}
        {notice && (
          <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--fg-secondary)]">{notice}</p>
        )}

        <div>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!ready}
            className="w-full rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-sm font-medium text-[var(--surface-0)] disabled:opacity-50"
          >
            Start recording
          </button>
          {blocked && <p className="mt-2 text-center text-xs text-[var(--fg-muted)]">{blocked}</p>}
        </div>
      </div>
    </div>
  );
}

/** A recognition session shorter than this is treated as failing, not finished. */
const SR_MIN_RUN_MS = 1_000;
/** How long to wait before restarting a session that is failing. */
const SR_RETRY_MS = 3_000;
/** The longest End waits for the last sentence before moving on without it. */
const SR_FINISH_MS = 2_000;
/** Errors a restart cannot fix. */
const SR_FATAL = new Set(["not-allowed", "service-not-allowed", "language-not-supported", "audio-capture"]);

/** The slice of the SpeechRecognition API this uses. Not in lib.dom for all targets. */
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string; confidence?: number } }>;
}
