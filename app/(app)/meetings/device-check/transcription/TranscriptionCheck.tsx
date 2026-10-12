"use client";

// The recogniser, fed four ways, against one spoken sentence.
//
// The room feeds each browser's speech engine the way recognizer-input.ts
// says to, and that file's rules were written from stored transcripts: Edge
// returning nonsense from the call's track, Chrome keeping whole sentences on
// it. A rule read from the rows of one host's calls is a rule worth checking
// on the next browser, the next microphone, and the next Edge update, before
// a meeting's record depends on it. So this page runs the same engine on the
// same microphone four ways — the engine's own capture, the call's processed
// track, a raw capture of the picked device, and that capture resampled to
// 16 kHz — for twelve seconds each, while the member reads one sentence, and
// shows what came back from each. The one that reads back the sentence is
// the one the room should be using for this browser.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { constraintsFor, devicesOfKind, releaseStream, type Device } from "@/lib/meetings/devices";
import { browserBrand } from "@/lib/meetings/recognizer-diagnostics";
import { captureConstraints, recognizerHearsPickedMic, recognizerInputMode } from "@/lib/meetings/recognizer-input";
import { recognitionLang } from "@/lib/meetings/recognition-quality";
import { engineFollowsTrack } from "@/lib/meetings/transcription-coverage";

const SENTENCE = "The committee reviewed the term sheet on Thursday and agreed to close the round before the end of the quarter.";
const LISTEN_MS = 12_000;

type ModeId = "bare" | "call-track" | "raw-capture" | "resampled";

interface Mode {
  id: ModeId;
  title: string;
  detail: string;
}

const MODES: Mode[] = [
  { id: "bare", title: "Engine's own capture", detail: "start() with nothing: the engine opens the system default microphone itself." },
  { id: "call-track", title: "Call track", detail: "The picked microphone with echo cancellation, noise suppression and gain control on, as the call sends it." },
  { id: "raw-capture", title: "Raw capture of the picked mic", detail: "The picked microphone with all processing off, opened for the recogniser alone." },
  { id: "resampled", title: "Raw capture at 16 kHz", detail: "The raw capture passed through a 16 kHz audio graph before the engine sees it." },
];

interface Outcome {
  mode: ModeId;
  finals: string[];
  interim: string;
  runs: number;
  errors: string[];
  confidences: Array<number | null>;
  failed: string | null;
}

type Phase = { kind: "idle" } | { kind: "listening"; mode: ModeId; secondsLeft: number } | { kind: "done" };

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: unknown) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: (track?: MediaStreamTrack) => void;
  abort: () => void;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function browserFacts() {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const brand = browserBrand(
    (nav as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } } | null)?.userAgentData?.brands ?? null,
    nav?.userAgent ?? null,
  );
  const available = engineFollowsTrack(recognitionCtor());
  return { brand, available };
}

/** Run one mode for LISTEN_MS, reporting the seconds left as it goes. */
async function runMode(
  mode: ModeId,
  micId: string,
  lang: string,
  tick: (secondsLeft: number) => void,
): Promise<Outcome> {
  const outcome: Outcome = { mode, finals: [], interim: "", runs: 0, errors: [], confidences: [], failed: null };
  const Ctor = recognitionCtor();
  if (!Ctor) { outcome.failed = "This browser has no speech recognition."; return outcome; }

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let track: MediaStreamTrack | null = null;
  try {
    if (mode === "call-track") {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraintsFor("audioinput", micId || null) });
      track = stream.getAudioTracks()[0] ?? null;
    } else if (mode === "raw-capture" || mode === "resampled") {
      stream = await navigator.mediaDevices.getUserMedia({ audio: captureConstraints(micId || null) });
      track = stream.getAudioTracks()[0] ?? null;
      if (mode === "resampled") {
        ctx = new AudioContext({ sampleRate: 16_000 });
        const source = ctx.createMediaStreamSource(stream);
        const dest = ctx.createMediaStreamDestination();
        source.connect(dest);
        await ctx.resume();
        track = dest.stream.getAudioTracks()[0] ?? null;
      }
    }
  } catch (err) {
    outcome.failed = `Could not open the microphone: ${(err as { name?: string })?.name ?? "error"}`;
    if (stream) releaseStream(stream);
    if (ctx) void ctx.close();
    return outcome;
  }

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = lang;
  let done = false;
  const start = () => {
    try { if (track) rec.start(track); else rec.start(); } catch (err) {
      outcome.errors.push(`start: ${(err as { name?: string })?.name ?? "error"}`);
    }
  };
  rec.onresult = (ev: unknown) => {
    const e = ev as { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }> & { isFinal: boolean }> };
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i];
      const alt = r[0];
      if (!alt) continue;
      if (r.isFinal) {
        outcome.finals.push(alt.transcript.trim());
        outcome.confidences.push(typeof alt.confidence === "number" ? alt.confidence : null);
      } else {
        interim += alt.transcript;
      }
    }
    outcome.interim = interim;
  };
  rec.onerror = (ev) => { outcome.errors.push(ev?.error ?? "error"); };
  rec.onend = () => {
    outcome.runs += 1;
    if (!done) start();
  };
  start();

  const startedAt = Date.now();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((LISTEN_MS - (Date.now() - startedAt)) / 1000));
      tick(left);
      if (left <= 0) { clearInterval(timer); resolve(); }
    }, 250);
  });

  done = true;
  rec.onend = null;
  try { rec.abort(); } catch { /* never started */ }
  if (stream) releaseStream(stream);
  if (ctx) void ctx.close();
  return outcome;
}

export function TranscriptionCheck() {
  const [mics, setMics] = useState<Device[]>([]);
  const [micId, setMicId] = useState("");
  const [permission, setPermission] = useState<"asking" | "granted" | "denied">("asking");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [copied, setCopied] = useState(false);
  const facts = useRef(browserFacts());
  const runningRef = useRef(false);

  // Labels come only after permission; a one-off capture earns it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        releaseStream(s);
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const found = devicesOfKind(
          list.map((d) => ({ deviceId: d.deviceId, kind: d.kind as Device["kind"], label: d.label, groupId: d.groupId })),
          "audioinput",
        );
        setMics(found);
        setMicId((cur) => cur || found[0]?.deviceId || "");
        setPermission("granted");
      } catch {
        if (!cancelled) setPermission("denied");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setOutcomes([]);
    setCopied(false);
    const lang = recognitionLang(typeof navigator !== "undefined" ? navigator.language : null);
    for (const mode of MODES) {
      setPhase({ kind: "listening", mode: mode.id, secondsLeft: Math.ceil(LISTEN_MS / 1000) });
      const outcome = await runMode(mode.id, micId, lang, (secondsLeft) => {
        setPhase({ kind: "listening", mode: mode.id, secondsLeft });
      });
      setOutcomes((prev) => [...prev, outcome]);
    }
    setPhase({ kind: "done" });
    runningRef.current = false;
  }, [micId]);

  const copy = useCallback(async () => {
    const report = {
      brand: facts.current.brand,
      available: facts.current.available,
      roomMode: recognizerInputMode({ brand: facts.current.brand }),
      hearsPickedMic: recognizerHearsPickedMic(facts.current),
      mic: mics.find((m) => m.deviceId === micId)?.label ?? micId,
      sentence: SENTENCE,
      outcomes,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
    } catch { /* clipboard refused; the page still shows it */ }
  }, [mics, micId, outcomes]);

  const roomMode = recognizerInputMode({ brand: facts.current.brand });
  const listening = phase.kind === "listening" ? phase : null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <Link href="/meetings/device-check" className="text-sm text-fg-muted underline-offset-2 hover:underline">
          ← Camera &amp; mic check
        </Link>
        <h1 className="text-xl font-semibold">Test transcription</h1>
        <p className="text-sm text-fg-muted">
          Read the sentence below out loud, four times over, while this page feeds your browser&apos;s
          speech engine your microphone four different ways. The way that reads the sentence back is
          the one a meeting should use.
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface-0/80 p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-fg-muted">Browser</dt>
          <dd>{facts.current.brand || "unknown"}</dd>
          <dt className="text-fg-muted">Engine exposes track support</dt>
          <dd>{facts.current.available ? "yes" : "no"}</dd>
          <dt className="text-fg-muted">A meeting feeds it</dt>
          <dd>{roomMode === "capture" ? "a raw capture of the picked mic" : "the call track"}
            {recognizerHearsPickedMic(facts.current) ? "" : " (which this engine ignores: it hears the system default)"}
          </dd>
        </dl>
      </section>

      <section className="space-y-3">
        <label className="block text-sm">
          <span className="text-fg-muted">Microphone</span>
          <select
            className="mt-1 w-full rounded-lg border border-line bg-surface-0 px-3 py-2"
            value={micId}
            onChange={(e) => setMicId(e.target.value)}
            disabled={permission !== "granted" || listening !== null}
          >
            {mics.map((m, i) => (
              <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>
            ))}
          </select>
        </label>
        {permission === "denied" && (
          <p className="text-sm text-status-danger">Microphone permission was refused. Allow it for this site and reload.</p>
        )}
        <blockquote className="rounded-lg border border-line p-3 text-base leading-relaxed">“{SENTENCE}”</blockquote>
        <button
          type="button"
          onClick={() => { void run(); }}
          disabled={permission !== "granted" || listening !== null}
          className="fx-tap rounded-full border border-line bg-surface-0 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {listening ? `Listening… ${listening.secondsLeft}s` : phase.kind === "done" ? "Run again" : "Run the test"}
        </button>
      </section>

      <section className="space-y-3">
        {MODES.map((mode) => {
          const outcome = outcomes.find((o) => o.mode === mode.id);
          const active = listening?.mode === mode.id;
          return (
            <article key={mode.id} className={`rounded-xl border p-4 text-sm ${active ? "border-fg" : "border-line"}`}>
              <h2 className="font-medium">{mode.title}{roomMode === "capture" && mode.id === "raw-capture" ? " · what a meeting uses here" : ""}{roomMode === "track" && mode.id === "call-track" ? " · what a meeting uses here" : ""}</h2>
              <p className="text-fg-muted">{mode.detail}</p>
              {active && <p className="mt-2">Read the sentence now… {listening?.secondsLeft}s</p>}
              {outcome && (
                <div className="mt-2 space-y-1">
                  {outcome.failed && <p className="text-status-danger">{outcome.failed}</p>}
                  <p className="whitespace-pre-wrap">
                    {outcome.finals.length ? outcome.finals.join(" ") : <span className="text-fg-muted">(nothing settled)</span>}
                    {outcome.interim && <span className="text-fg-muted"> {outcome.interim}</span>}
                  </p>
                  <p className="text-fg-muted">
                    {outcome.runs} run{outcome.runs === 1 ? "" : "s"} ended
                    {outcome.confidences.length ? ` · engine confidence ${outcome.confidences.map((c) => (c === null ? "none" : c.toFixed(2))).join(", ")}` : ""}
                    {outcome.errors.length ? ` · errors: ${outcome.errors.join(", ")}` : ""}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </section>

      {phase.kind === "done" && (
        <button
          type="button"
          onClick={() => { void copy(); }}
          className="fx-tap rounded-full border border-line bg-surface-0 px-4 py-2 text-sm"
        >
          {copied ? "Copied" : "Copy results"}
        </button>
      )}
    </main>
  );
}
