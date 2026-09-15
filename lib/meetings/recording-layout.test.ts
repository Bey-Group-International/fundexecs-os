import {
  MAX_STRIP_TILES,
  NO_FOCUS,
  SPEAKER_MARGIN,
  SPEAKER_SETTLE_MS,
  SPEAKER_SHARE,
  byRecentVoice,
  composeStage,
  coverRect,
  gridRects,
  gridShape,
  loudestSpeaker,
  stepFocus,
  type StageParticipant,
} from "@/lib/meetings/recording-layout";

const W = 1280;
const H = 720;

function person(id: string, hasVideo = true): StageParticipant {
  return { id, displayName: id, hasVideo };
}

describe("loudestSpeaker", () => {
  it("names whoever is clearly holding the floor", () => {
    expect(loudestSpeaker([{ speakerId: "a", share: 0.8 }, { speakerId: "b", share: 0.1 }]))
      .toBe("a");
  });

  it("names nobody when the room is quiet", () => {
    expect(loudestSpeaker([{ speakerId: "a", share: SPEAKER_SHARE - 0.01 }])).toBeNull();
    expect(loudestSpeaker([])).toBeNull();
  });

  // Two people in a real back-and-forth would otherwise swap the large tile
  // every couple of seconds, which is exhausting to watch.
  it("names nobody during crosstalk", () => {
    const close = [
      { speakerId: "a", share: 0.6 },
      { speakerId: "b", share: 0.6 - (SPEAKER_MARGIN - 0.01) },
    ];
    expect(loudestSpeaker(close)).toBeNull();
  });
});

describe("stepFocus", () => {
  it("cuts to a challenger only once they have held the floor", () => {
    const loud = [{ speakerId: "a", share: 0.9 }];
    let state = stepFocus(NO_FOCUS, loud, 0);
    expect(state.speakerId).toBeNull();
    expect(state.pendingId).toBe("a");

    state = stepFocus(state, loud, SPEAKER_SETTLE_MS - 1);
    expect(state.speakerId).toBeNull();

    state = stepFocus(state, loud, SPEAKER_SETTLE_MS);
    expect(state.speakerId).toBe("a");
  });

  // The failure mode this exists to prevent: cutting to somebody who said
  // "mm-hm" and cutting straight back.
  it("ignores an interjection that does not last", () => {
    const held = { speakerId: "a", pendingId: null, pendingSince: 0 };
    let state = stepFocus(held, [{ speakerId: "b", share: 0.9 }], 1_000);
    expect(state.pendingId).toBe("b");
    // b stops; a resumes.
    state = stepFocus(state, [{ speakerId: "a", share: 0.9 }], 1_400);
    expect(state.speakerId).toBe("a");
    expect(state.pendingId).toBeNull();
  });

  it("restarts the clock when the challenger changes", () => {
    const held = { speakerId: "a", pendingId: null, pendingSince: 0 };
    let state = stepFocus(held, [{ speakerId: "b", share: 0.9 }], 0);
    state = stepFocus(state, [{ speakerId: "c", share: 0.9 }], 1_000);
    expect(state.pendingId).toBe("c");
    expect(state.pendingSince).toBe(1_000);
    state = stepFocus(state, [{ speakerId: "c", share: 0.9 }], 1_000 + SPEAKER_SETTLE_MS - 1);
    expect(state.speakerId).toBe("a");
  });

  // Cutting to the grid during every pause for breath is its own flicker.
  it("keeps the last speaker framed through a silence", () => {
    const held = { speakerId: "a", pendingId: null, pendingSince: 0 };
    expect(stepFocus(held, [], 5_000).speakerId).toBe("a");
  });

  it("returns the same object when nothing changed, so a draw loop can skip work", () => {
    const held = { speakerId: "a", pendingId: null, pendingSince: 0 };
    expect(stepFocus(held, [{ speakerId: "a", share: 0.9 }], 10)).toBe(held);
  });
});

describe("gridShape", () => {
  it("prefers squares to strips", () => {
    // Four slivers in a 16:9 frame is not a layout.
    expect(gridShape(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridShape(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(9)).toEqual({ cols: 3, rows: 3 });
  });

  it("handles the degenerate cases", () => {
    expect(gridShape(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(0)).toEqual({ cols: 1, rows: 1 });
  });
});

describe("gridRects", () => {
  it("gives every tile the same size", () => {
    const rects = gridRects(5, W, H);
    expect(rects).toHaveLength(5);
    const first = rects[0];
    for (const r of rects) {
      expect(r.width).toBeCloseTo(first.width, 5);
      expect(r.height).toBeCloseTo(first.height, 5);
    }
  });

  it("keeps every tile inside the frame", () => {
    for (const count of [1, 2, 3, 4, 5, 7, 9, 12]) {
      for (const r of gridRects(count, W, H)) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(W + 0.001);
        expect(r.y + r.height).toBeLessThanOrEqual(H + 0.001);
      }
    }
  });

  // A five-person call ending on one lonely tile pinned to the left.
  it("centres a short last row", () => {
    // 5 tiles is 3 columns over 2 rows, so the last row holds 2. The ROW is
    // centred, not each tile in it: the midpoint between the left edge of the
    // first and the right edge of the last should sit on the frame's centre.
    const rects = gridRects(5, W, H);
    const first = rects[3];
    const last = rects[4];
    expect((first.x + last.x + last.width) / 2).toBeCloseTo(W / 2, 5);
    // And it really is indented — otherwise this passes for a full row too.
    expect(first.x).toBeGreaterThan(rects[0].x);
  });

  it("is empty for nobody", () => {
    expect(gridRects(0, W, H)).toEqual([]);
  });
});

describe("composeStage", () => {
  const four = [person("a"), person("b"), person("c"), person("d")];

  it("gives the frame to a shared screen", () => {
    const stage = composeStage({
      participants: four, activity: [], focus: NO_FOCUS,
      screenSharerId: "a", width: W, height: H,
    });
    expect(stage.mode).toBe("screen");
    expect(stage.screenRect).not.toBeNull();
    // The sharer's own camera tile does not compete with what they are showing.
    expect(stage.tiles.map((t) => t.id)).toEqual(["b", "c", "d"]);
    expect(stage.screenRect!.width).toBeGreaterThan(W * 0.7);
  });

  it("falls back to the grid when nobody holds the floor", () => {
    const stage = composeStage({
      participants: four, activity: [], focus: NO_FOCUS,
      screenSharerId: null, width: W, height: H,
    });
    expect(stage.mode).toBe("grid");
    expect(stage.tiles).toHaveLength(4);
    expect(stage.tiles.every((t) => !t.primary)).toBe(true);
  });

  it("gives the large tile to the focused speaker", () => {
    const stage = composeStage({
      participants: four, activity: [],
      focus: { speakerId: "c", pendingId: null, pendingSince: 0 },
      screenSharerId: null, width: W, height: H,
    });
    expect(stage.mode).toBe("speaker");
    const primary = stage.tiles.find((t) => t.primary);
    expect(primary?.id).toBe("c");
    expect(primary!.rect.width).toBeGreaterThan(W * 0.7);
  });

  it("shows one person as a grid of one, not a speaker view", () => {
    const stage = composeStage({
      participants: [person("a")], activity: [],
      focus: { speakerId: "a", pendingId: null, pendingSince: 0 },
      screenSharerId: null, width: W, height: H,
    });
    expect(stage.mode).toBe("grid");
  });

  // Fifteen postage stamps cost a draw call each and show nothing.
  it("caps the side strip", () => {
    const many = Array.from({ length: 12 }, (_, i) => person(`p${i}`));
    const stage = composeStage({
      participants: many, activity: [],
      focus: { speakerId: "p0", pendingId: null, pendingSince: 0 },
      screenSharerId: null, width: W, height: H,
    });
    expect(stage.tiles.filter((t) => !t.primary)).toHaveLength(MAX_STRIP_TILES);
  });

  it("uses the whole frame when the sharer is alone", () => {
    const stage = composeStage({
      participants: [person("a")], activity: [], focus: NO_FOCUS,
      screenSharerId: "a", width: W, height: H,
    });
    expect(stage.tiles).toHaveLength(0);
    expect(stage.screenRect!.width).toBeCloseTo(W - 16, 5);
  });

  it("draws nothing for an empty room", () => {
    const stage = composeStage({
      participants: [], activity: [], focus: NO_FOCUS,
      screenSharerId: null, width: W, height: H,
    });
    expect(stage.tiles).toEqual([]);
  });

  it("keeps every tile inside the frame in every mode", () => {
    const cases = [
      { screenSharerId: "a", focus: NO_FOCUS },
      { screenSharerId: null, focus: { speakerId: "b", pendingId: null, pendingSince: 0 } },
      { screenSharerId: null, focus: NO_FOCUS },
    ];
    for (const c of cases) {
      const stage = composeStage({
        participants: four, activity: [], width: W, height: H, ...c,
      });
      for (const t of stage.tiles) {
        expect(t.rect.x).toBeGreaterThanOrEqual(0);
        expect(t.rect.y).toBeGreaterThanOrEqual(0);
        expect(t.rect.x + t.rect.width).toBeLessThanOrEqual(W + 0.001);
        expect(t.rect.y + t.rect.height).toBeLessThanOrEqual(H + 0.001);
      }
    }
  });
});

describe("coverRect", () => {
  it("crops the sides of a wide source rather than shrinking all of it", () => {
    const out = coverRect(1920, 1080, { x: 0, y: 0, width: 100, height: 100 });
    expect(out.sHeight).toBe(1080);
    expect(out.sWidth).toBeCloseTo(1080, 5);
    expect(out.sx).toBeCloseTo((1920 - 1080) / 2, 5);
  });

  it("crops the top and bottom of a portrait phone camera", () => {
    const out = coverRect(720, 1280, { x: 0, y: 0, width: 160, height: 90 });
    expect(out.sWidth).toBe(720);
    expect(out.sHeight).toBeCloseTo(720 / (160 / 90), 5);
    expect(out.sy).toBeGreaterThan(0);
  });

  it("survives a source with no dimensions yet", () => {
    // A video element reports 0×0 until its first frame decodes.
    expect(() => coverRect(0, 0, { x: 0, y: 0, width: 100, height: 100 })).not.toThrow();
  });
});

describe("byRecentVoice", () => {
  it("puts the people taking part at the front of the strip", () => {
    const out = byRecentVoice(
      [person("quiet"), person("loud"), person("mid")],
      [{ speakerId: "loud", share: 0.9 }, { speakerId: "mid", share: 0.4 }],
    );
    expect(out.map((p) => p.id)).toEqual(["loud", "mid", "quiet"]);
  });

  it("does not mutate its input", () => {
    const people = [person("a"), person("b")];
    byRecentVoice(people, [{ speakerId: "b", share: 1 }]);
    expect(people.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
