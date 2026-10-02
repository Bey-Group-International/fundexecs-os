import {
  RETURN_CONFIRM,
  createReturnWatch,
  observeVoiceReturn,
  voiceReturnNotice,
} from "@/lib/meetings/voice-return";

/** A speech-like envelope: syllables and pauses, deterministic. */
function speech(n: number, seed = 1): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    // Mostly talking, with gaps, and a level that moves syllable to syllable.
    out.push(i % 11 < 8 ? 0.1 + r * 0.4 : r * 0.02);
  }
  return out;
}

function run(local: number[], remote: (t: number) => number, id = "peer") {
  const watch = createReturnWatch();
  const started: number[] = [];
  const cleared: number[] = [];
  local.forEach((l, t) => {
    const v = observeVoiceReturn(watch, { local: l, remotes: new Map([[id, remote(t)]]) });
    if (v.started.includes(id)) started.push(t);
    if (v.cleared.includes(id)) cleared.push(t);
  });
  return { started, cleared };
}

describe("observeVoiceReturn", () => {
  it("flags a peer whose audio is the member's own voice, a few samples late", () => {
    const voice = speech(200);
    const { started } = run(voice, (t) => (t >= 3 ? voice[t - 3] * 0.6 : 0));
    expect(started.length).toBe(1);
  });

  it("flags it through noise and a level change, as a second microphone across a room would", () => {
    const voice = speech(200);
    const noise = speech(200, 7);
    const { started } = run(voice, (t) => (t >= 2 ? voice[t - 2] * 0.3 + noise[t] * 0.03 : 0));
    expect(started.length).toBe(1);
  });

  it("leaves turn-taking alone: the peer talks when the member stops", () => {
    const voice = speech(200);
    const local = voice.map((v, t) => (Math.floor(t / 25) % 2 === 0 ? v : 0.005));
    const remote = (t: number) => (Math.floor(t / 25) % 2 === 1 ? speech(200, 3)[t] : 0.005);
    expect(run(local, remote).started).toEqual([]);
  });

  it("leaves two people talking over each other alone", () => {
    const { started } = run(speech(200, 1), (t) => speech(200, 5)[t]);
    expect(started).toEqual([]);
  });

  it("says nothing about a peer who is silent", () => {
    expect(run(speech(200), () => 0).started).toEqual([]);
  });

  it("says nothing while the member is muted", () => {
    const voice = speech(200);
    expect(run(voice.map(() => 0), (t) => voice[Math.max(0, t - 3)]).started).toEqual([]);
  });

  it("needs several confirmations, not one lucky window", () => {
    const voice = speech(200);
    const { started } = run(voice, (t) => (t >= 3 ? voice[t - 3] : 0));
    // The first verdict cannot come before the minimum speech plus the
    // confirmations have been seen.
    expect(started[0]).toBeGreaterThanOrEqual(20 + RETURN_CONFIRM - 1);
  });

  it("clears once the peer stops carrying the member's voice", () => {
    const voice = speech(400);
    const other = speech(400, 9);
    const { started, cleared } = run(voice, (t) => (t < 150 ? (t >= 3 ? voice[t - 3] : 0) : other[t]));
    expect(started.length).toBe(1);
    expect(cleared.length).toBe(1);
    expect(cleared[0]).toBeGreaterThan(started[0]);
  });

  it("forgets a peer who leaves", () => {
    const watch = createReturnWatch();
    const voice = speech(100);
    voice.forEach((l, t) => observeVoiceReturn(watch, { local: l, remotes: new Map([["p", t >= 3 ? voice[t - 3] : 0]]) }));
    observeVoiceReturn(watch, { local: 0.2, remotes: new Map() });
    expect(watch.peers.size).toBe(0);
  });
});

describe("voiceReturnNotice", () => {
  it("names who was muted on this device", () => {
    expect(voiceReturnNotice(["Brett"])).toMatch(/^Brett seems to be in the same room/);
    expect(voiceReturnNotice(["Brett", "Carla"])).toMatch(/^Brett and Carla seem/);
  });
});
