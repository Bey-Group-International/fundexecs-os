import { createFallbackRecognition, MAX_BACKLOG, type FallbackDeps, type WorkerLike } from "./recognition";
import type { WorkerRequest, WorkerResponse } from "./protocol";

function harness() {
  const listeners = new Set<(ev: { data: WorkerResponse }) => void>();
  const sent: WorkerRequest[] = [];
  const worker: WorkerLike = {
    postMessage: (m) => { sent.push(m); },
    addEventListener: (_t, fn) => { listeners.add(fn); },
    removeEventListener: (_t, fn) => { listeners.delete(fn); },
  };
  const reply = (m: WorkerResponse) => listeners.forEach((fn) => fn({ data: m }));
  let onFrame: (f: Float32Array, rate: number) => void = () => {};
  const stops: number[] = [];
  const deps: FallbackDeps = {
    getWorker: () => worker,
    startCapture: async (_t, cb) => { onFrame = cb; return { stop: () => { stops.push(1); } }; },
  };
  const SR = createFallbackRecognition(deps);
  const rec = new SR();
  const events: string[] = [];
  const texts: string[] = [];
  rec.onstart = () => events.push("start");
  rec.onspeechstart = () => events.push("speechstart");
  rec.onend = () => events.push("end");
  rec.onerror = (e) => events.push(`error:${e.error}`);
  rec.onresult = (e) => texts.push(e.results[0][0].transcript);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** One second of speech then enough silence to close it, at 16 kHz. */
  const speak = () => {
    for (let i = 0; i < 10; i++) onFrame(new Float32Array(1600).fill(0.1), 16000);
    for (let i = 0; i < 8; i++) onFrame(new Float32Array(1600).fill(0), 16000);
  };
  return { SR, rec, reply, sent, events, texts, flush, speak, stops, listeners };
}

describe("FallbackSpeechRecognition", () => {
  it("looks like an engine that follows the track", () => {
    expect(typeof harness().SR.available).toBe("function");
  });

  it("asks the worker to load, and reports start only once the model is ready", async () => {
    const h = harness();
    h.rec.start();
    expect(h.sent[0]).toEqual({ type: "load" });
    expect(h.events).toEqual([]);
    h.reply({ type: "ready" });
    await h.flush();
    expect(h.events).toEqual(["start"]);
  });

  it("turns a spoken utterance into one final result, dropping phantoms", async () => {
    const h = harness();
    h.rec.lang = "en-GB";
    h.rec.start();
    h.reply({ type: "ready" });
    await h.flush();
    h.speak();
    expect(h.events).toContain("speechstart");
    const req = h.sent.find((m) => m.type === "transcribe") as Extract<WorkerRequest, { type: "transcribe" }>;
    expect(req.language).toBe("english");
    h.reply({ type: "result", id: req.id, text: " The LPAC meets Tuesday. " });
    expect(h.texts).toEqual(["The LPAC meets Tuesday."]);

    h.speak();
    const req2 = h.sent.filter((m) => m.type === "transcribe")[1] as Extract<WorkerRequest, { type: "transcribe" }>;
    h.reply({ type: "result", id: req2.id, text: "Thank you." });
    expect(h.texts).toHaveLength(1);
  });

  it("decodes one utterance at a time and caps the backlog", async () => {
    const h = harness();
    h.rec.start(); h.reply({ type: "ready" }); await h.flush();
    for (let i = 0; i < MAX_BACKLOG + 3; i++) h.speak();
    expect(h.sent.filter((m) => m.type === "transcribe")).toHaveLength(1);
  });

  it("reports a missing model as an error and ends", async () => {
    const h = harness();
    h.rec.start();
    h.reply({ type: "model-missing" });
    expect(h.events).toEqual(["error:service-not-allowed", "end"]);
    expect(h.listeners.size).toBe(0);
  });

  it("stop() still transcribes what was being said, then ends and stops the mic tap", async () => {
    const h = harness();
    h.rec.start(); h.reply({ type: "ready" }); await h.flush();
    h.speak();
    const first = h.sent.find((m) => m.type === "transcribe") as Extract<WorkerRequest, { type: "transcribe" }>;
    h.rec.stop();
    expect(h.events).not.toContain("end");
    h.reply({ type: "result", id: first.id, text: "Last words." });
    expect(h.texts).toEqual(["Last words."]);
    expect(h.events[h.events.length - 1]).toBe("end");
    expect(h.stops.length).toBe(1);
  });
});
