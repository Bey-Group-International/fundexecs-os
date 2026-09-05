import {
  ACTIVITY_WINDOW_MS,
  LOCAL_SPEAKER_ID,
  LOW_CONFIDENCE,
  VoiceActivityLog,
  attributeUtterance,
  formatTranscriptLine,
  isSpeaking,
  speakerColorIndex,
  speakingIds,
  suppressionReason,
  type ParticipantAudio,
} from "@/lib/meetings/speaker-attribution";

const T0 = 1_700_000_000_000;

const PEOPLE: ParticipantAudio[] = [
  { id: LOCAL_SPEAKER_ID, displayName: "Ada", micOn: true, isLocal: true },
  { id: "peer-1", displayName: "Grace", micOn: true, isLocal: false },
  { id: "peer-2", displayName: "Alan", micOn: true, isLocal: false },
];

/** Fill a window with one level per speaker, one sample per 100ms. */
function fill(log: VoiceActivityLog, levels: Record<string, number>, from: number, to: number) {
  for (let ts = from; ts <= to; ts += 100) {
    for (const [id, level] of Object.entries(levels)) log.record(id, level, ts);
  }
}

describe("VoiceActivityLog", () => {
  it("summarizes share and peak per speaker over a window", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.4, "peer-1": 0.01 }, T0, T0 + 1000);

    const [loudest, quietest] = log.summarize(T0, T0 + 1000);
    expect(loudest.speakerId).toBe(LOCAL_SPEAKER_ID);
    expect(loudest.share).toBe(1);
    expect(loudest.peak).toBeCloseTo(0.4);
    expect(quietest.share).toBe(0);
  });

  it("ignores samples outside the requested window", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.5 }, T0, T0 + 500);
    fill(log, { "peer-1": 0.5 }, T0 + 5000, T0 + 5500);

    expect(log.summarize(T0, T0 + 500).map((s) => s.speakerId)).toEqual([LOCAL_SPEAKER_ID]);
  });

  it("widens a zero-length window so an instant utterance still finds samples", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.5 }, T0, T0 + 400);

    expect(log.summarize(T0 + 400, T0 + 400)[0].share).toBe(1);
  });

  it("prunes samples older than its window instead of growing without bound", () => {
    const log = new VoiceActivityLog(1000);
    fill(log, { [LOCAL_SPEAKER_ID]: 0.3 }, T0, T0 + 900);
    const grown = log.size;
    log.record(LOCAL_SPEAKER_ID, 0.3, T0 + 5000);

    expect(log.size).toBeLessThan(grown);
    expect(log.summarize(T0, T0 + 900)).toEqual([]);
  });

  it("keeps a full default window of history", () => {
    const log = new VoiceActivityLog();
    log.record(LOCAL_SPEAKER_ID, 0.4, T0);
    log.record(LOCAL_SPEAKER_ID, 0.4, T0 + ACTIVITY_WINDOW_MS - 100);

    expect(log.summarize(T0, T0 + ACTIVITY_WINDOW_MS)[0].samples).toBe(2);
  });

  it("drops non-finite levels rather than poisoning the average", () => {
    const log = new VoiceActivityLog();
    log.record(LOCAL_SPEAKER_ID, Number.NaN, T0);

    expect(log.size).toBe(0);
  });
});

describe("attributeUtterance", () => {
  const window = { startedAt: T0, endedAt: T0 + 1500 };

  it("credits the local user when their mic is live and their voice dominates", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.45, "peer-1": 0.0 }, window.startedAt, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: true });
    expect(a.speakerId).toBe(LOCAL_SPEAKER_ID);
    expect(a.displayName).toBe("Ada");
    expect(a.basis).toBe("local-voice");
    expect(a.publish).toBe(true);
    expect(a.confidence).toBeGreaterThan(LOW_CONFIDENCE);
  });

  it("never credits the local user while their mic is muted", () => {
    const log = new VoiceActivityLog();
    fill(log, { "peer-1": 0.5 }, window.startedAt, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: false });
    expect(a.basis).toBe("mic-muted");
    expect(a.speakerId).toBe("peer-1");
    expect(a.displayName).toBe("Grace");
    expect(a.publish).toBe(false);
  });

  it("withholds nothing but the attribution when muted with nobody audible", () => {
    const log = new VoiceActivityLog();

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: false });
    expect(a.basis).toBe("mic-muted");
    expect(a.speakerId).toBeNull();
    expect(a.publish).toBe(false);
  });

  it("blames speaker bleed on the peer, not the open mic that heard it", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.01, "peer-1": 0.5 }, window.startedAt, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: true });
    expect(a.basis).toBe("echo");
    expect(a.speakerId).toBe("peer-1");
    expect(a.publish).toBe(false);
  });

  it("picks the loudest peer when two of them bleed through at once", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.0, "peer-2": 0.6 }, window.startedAt, window.endedAt);
    // peer-1 audible for most but not all of the window, so a lower share.
    fill(log, { "peer-1": 0.5 }, window.startedAt, window.startedAt + 900);
    fill(log, { "peer-1": 0.0 }, window.startedAt + 1000, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: true });
    expect(a.speakerId).toBe("peer-2");
    expect(a.displayName).toBe("Alan");
  });

  it("keeps a short interjection over a peer rather than calling it echo", () => {
    const log = new VoiceActivityLog();
    // The peer holds the floor; the local user says "yes, agreed" across a
    // fifth of the window. Quieter than the peer, but real speech that is ours.
    fill(log, { "peer-1": 0.5 }, window.startedAt, window.endedAt);
    fill(log, { [LOCAL_SPEAKER_ID]: 0.4 }, window.startedAt, window.startedAt + 300);
    fill(log, { [LOCAL_SPEAKER_ID]: 0.0 }, window.startedAt + 400, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: true });
    expect(a.publish).toBe(true);
    expect(a.speakerId).toBe(LOCAL_SPEAKER_ID);
    expect(a.basis).toBe("cross-talk");
  });

  it("still calls it echo when the local mic never crossed the speech threshold", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.03, "peer-1": 0.5 }, window.startedAt, window.endedAt);

    expect(attributeUtterance(window, log, PEOPLE, { localMicOn: true }).basis).toBe("echo");
  });

  it("does not call it echo when the peer only briefly cut in", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.0 }, window.startedAt, window.endedAt);
    fill(log, { "peer-1": 0.5 }, window.startedAt, window.startedAt + 200);
    fill(log, { "peer-1": 0.0 }, window.startedAt + 300, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: true });
    expect(a.publish).toBe(true);
    expect(a.speakerId).toBe(LOCAL_SPEAKER_ID);
  });

  it("flags cross-talk but still publishes the local line", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.4, "peer-1": 0.4 }, window.startedAt, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: true });
    expect(a.basis).toBe("cross-talk");
    expect(a.overlapped).toBe(true);
    expect(a.publish).toBe(true);
    expect(a.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("keeps an unplaceable line rather than losing real speech", () => {
    const a = attributeUtterance(window, new VoiceActivityLog(), PEOPLE, { localMicOn: true });
    expect(a.basis).toBe("unattributed");
    expect(a.speakerId).toBe(LOCAL_SPEAKER_ID);
    expect(a.publish).toBe(true);
    expect(a.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("leaves the name null when the attributed peer has already left", () => {
    const log = new VoiceActivityLog();
    fill(log, { [LOCAL_SPEAKER_ID]: 0.0, "peer-9": 0.5 }, window.startedAt, window.endedAt);

    const a = attributeUtterance(window, log, PEOPLE, { localMicOn: true });
    expect(a.speakerId).toBe("peer-9");
    expect(a.displayName).toBeNull();
  });
});

describe("isSpeaking", () => {
  it("is false whenever the mic is muted, however loud the room", () => {
    expect(isSpeaking(0.9, false)).toBe(false);
  });

  it("is false for room tone and true for speech", () => {
    expect(isSpeaking(0.02, true)).toBe(false);
    expect(isSpeaking(0.3, true)).toBe(true);
  });
});

describe("speakingIds", () => {
  it("holds a speaker through the gaps between words", () => {
    const seen = new Map([["peer-1", T0]]);
    expect(speakingIds(seen, T0 + 500)).toEqual(new Set(["peer-1"]));
  });

  it("releases a speaker once the hold expires", () => {
    const seen = new Map([["peer-1", T0]]);
    expect(speakingIds(seen, T0 + 5000)).toEqual(new Set());
  });
});

describe("suppressionReason", () => {
  it("explains a muted mic without naming anyone else", () => {
    expect(suppressionReason("mic-muted", "Grace")).toMatch(/muted/);
  });

  it("names the peer whose voice bled through", () => {
    expect(suppressionReason("echo", "Grace")).toContain("Grace");
  });

  it("falls back to a neutral phrase for an unnamed peer", () => {
    expect(suppressionReason("echo", null)).toContain("another participant");
  });
});

describe("formatTranscriptLine", () => {
  it("renders a confident line plainly", () => {
    expect(formatTranscriptLine({ speaker: "Ada", text: "Send the deck", confidence: 0.9 }))
      .toBe("Ada: Send the deck");
  });

  it("treats a line with no confidence recorded as confident", () => {
    expect(formatTranscriptLine({ speaker: "Ada", text: "Send the deck" })).toBe("Ada: Send the deck");
  });

  it("marks a low-confidence line so the model does not inherit our guess", () => {
    expect(formatTranscriptLine({ speaker: "Ada", text: "Send the deck", confidence: 0.4 }))
      .toBe("Ada (uncertain): Send the deck");
  });

  it("says when the doubt comes from people talking over each other", () => {
    expect(formatTranscriptLine({ speaker: "Ada", text: "Send the deck", confidence: 0.5, overlapped: true }))
      .toBe("Ada (uncertain — people speaking over each other): Send the deck");
  });

  it("names an empty speaker rather than emitting a bare colon", () => {
    expect(formatTranscriptLine({ speaker: "", text: "Send the deck" })).toBe("Unknown speaker: Send the deck");
  });
});

describe("speakerColorIndex", () => {
  it("is stable for an id and within range", () => {
    const first = speakerColorIndex("peer-1", 6);
    expect(speakerColorIndex("peer-1", 6)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(6);
  });

  it("survives a zero palette instead of dividing by it", () => {
    expect(speakerColorIndex("peer-1", 0)).toBe(0);
  });
});
