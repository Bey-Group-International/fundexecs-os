import {
  MINUTES_IN_DAY,
  MIN_DURATION_MINUTES,
  canDragMeeting,
  columnFromOffset,
  describeSpan,
  durationOf,
  formatMinute,
  isNoOp,
  minuteFromOffset,
  movedEnough,
  previewFor,
  previewStartIso,
  snapMinute,
  type DragOrigin,
} from "./calendar-drag";
import type { CalendarMeeting } from "./calendar";

const HOUR_PX = 46;

function origin(over: Partial<DragOrigin> = {}): DragOrigin {
  return {
    meetingId: "m1",
    mode: "move",
    startMinute: 600, // 10:00
    endMinute: 660, // 11:00
    dayIndex: 2,
    grabOffsetMinute: 0,
    ...over,
  };
}

describe("snapMinute", () => {
  it("rounds to the quarter hour", () => {
    expect(snapMinute(607)).toBe(600);
    expect(snapMinute(608)).toBe(615);
    expect(snapMinute(615)).toBe(615);
  });

  it("accepts another step", () => {
    expect(snapMinute(607, 30)).toBe(600);
    expect(snapMinute(616, 30)).toBe(630);
  });

  it("survives nonsense rather than producing NaN geometry", () => {
    expect(snapMinute(NaN)).toBe(0);
    expect(snapMinute(Infinity)).toBe(0);
    expect(snapMinute(607, 0)).toBe(607);
  });
});

describe("minuteFromOffset", () => {
  it("converts pixels to minutes at the grid's scale", () => {
    expect(minuteFromOffset(0, HOUR_PX)).toBe(0);
    expect(minuteFromOffset(HOUR_PX, HOUR_PX)).toBe(60);
    expect(minuteFromOffset(HOUR_PX * 10, HOUR_PX)).toBe(600);
  });

  it("clamps to the day, so a drag past the edge stops at the edge", () => {
    expect(minuteFromOffset(-50, HOUR_PX)).toBe(0);
    expect(minuteFromOffset(HOUR_PX * 30, HOUR_PX)).toBe(MINUTES_IN_DAY);
  });

  it("does not divide by a zero row height", () => {
    expect(minuteFromOffset(100, 0)).toBe(0);
  });
});

describe("columnFromOffset", () => {
  it("picks the day column under the pointer", () => {
    expect(columnFromOffset(0, 100, 7)).toBe(0);
    expect(columnFromOffset(250, 100, 7)).toBe(2);
    expect(columnFromOffset(699, 100, 7)).toBe(6);
  });

  it("clamps rather than running off either end", () => {
    expect(columnFromOffset(-20, 100, 7)).toBe(0);
    expect(columnFromOffset(5000, 100, 7)).toBe(6);
  });

  it("is always column zero in day view", () => {
    expect(columnFromOffset(500, 100, 1)).toBe(0);
  });
});

describe("movedEnough", () => {
  it("ignores the wobble in a click", () => {
    expect(movedEnough(0, 0)).toBe(false);
    expect(movedEnough(2, 3)).toBe(false);
  });

  it("recognises a real drag on either axis", () => {
    expect(movedEnough(0, 6)).toBe(true);
    expect(movedEnough(-9, 0)).toBe(true);
  });
});

describe("previewFor — move", () => {
  it("moves the event to the pointer, keeping its duration", () => {
    const p = previewFor(origin(), { minute: 840, dayIndex: 2 }, { dayCount: 7 });
    expect(p).toEqual({ startMinute: 840, endMinute: 900, dayIndex: 2 });
    expect(durationOf(p)).toBe(60);
  });

  it("keeps the grab offset, so the block does not jump under the cursor", () => {
    // Grabbed 30 minutes down the event; dropping the pointer at 14:00 should
    // put the event's START at 13:30, not at 14:00.
    const p = previewFor(origin({ grabOffsetMinute: 30 }), { minute: 840, dayIndex: 2 }, { dayCount: 7 });
    expect(p.startMinute).toBe(810);
    expect(p.endMinute).toBe(870);
  });

  it("snaps to the quarter hour", () => {
    const p = previewFor(origin(), { minute: 847, dayIndex: 2 }, { dayCount: 7 });
    expect(p.startMinute).toBe(840);
  });

  it("crosses to another day column", () => {
    const p = previewFor(origin(), { minute: 600, dayIndex: 5 }, { dayCount: 7 });
    expect(p.dayIndex).toBe(5);
    expect(p.startMinute).toBe(600);
  });

  it("clamps the column to the days on screen", () => {
    expect(previewFor(origin(), { minute: 600, dayIndex: 99 }, { dayCount: 7 }).dayIndex).toBe(6);
    expect(previewFor(origin(), { minute: 600, dayIndex: -3 }, { dayCount: 7 }).dayIndex).toBe(0);
  });

  it("never pushes the tail past midnight", () => {
    // A 60-minute event dragged to the very bottom must end at 24:00, not 25:00.
    const p = previewFor(origin(), { minute: MINUTES_IN_DAY, dayIndex: 2 }, { dayCount: 7 });
    expect(p.endMinute).toBe(MINUTES_IN_DAY);
    expect(p.startMinute).toBe(MINUTES_IN_DAY - 60);
  });

  it("never pushes the head above midnight", () => {
    const p = previewFor(origin({ grabOffsetMinute: 45 }), { minute: 10, dayIndex: 2 }, { dayCount: 7 });
    expect(p.startMinute).toBe(0);
    expect(p.endMinute).toBe(60);
  });

  it("keeps a long event whole at the bottom of the day", () => {
    const p = previewFor(
      origin({ startMinute: 60, endMinute: 300 }), // 4 hours
      { minute: MINUTES_IN_DAY, dayIndex: 0 },
      { dayCount: 1 },
    );
    expect(durationOf(p)).toBe(240);
    expect(p.endMinute).toBe(MINUTES_IN_DAY);
  });
});

describe("previewFor — resize", () => {
  it("drags the bottom edge", () => {
    const p = previewFor(origin({ mode: "resize-end" }), { minute: 750, dayIndex: 2 });
    expect(p).toEqual({ startMinute: 600, endMinute: 750, dayIndex: 2 });
  });

  it("will not shrink the bottom edge past the minimum", () => {
    const p = previewFor(origin({ mode: "resize-end" }), { minute: 300, dayIndex: 2 });
    expect(p.endMinute).toBe(600 + MIN_DURATION_MINUTES);
    expect(p.startMinute).toBe(600);
  });

  it("drags the top edge", () => {
    const p = previewFor(origin({ mode: "resize-start" }), { minute: 510, dayIndex: 2 });
    expect(p).toEqual({ startMinute: 510, endMinute: 660, dayIndex: 2 });
  });

  it("will not push the top edge past the minimum", () => {
    const p = previewFor(origin({ mode: "resize-start" }), { minute: 900, dayIndex: 2 });
    expect(p.startMinute).toBe(660 - MIN_DURATION_MINUTES);
    expect(p.endMinute).toBe(660);
  });

  it("clamps a resize to the day", () => {
    expect(previewFor(origin({ mode: "resize-end" }), { minute: 5000, dayIndex: 2 }).endMinute).toBe(MINUTES_IN_DAY);
    expect(previewFor(origin({ mode: "resize-start" }), { minute: -60, dayIndex: 2 }).startMinute).toBe(0);
  });

  it("stays in its own day, however far sideways the pointer goes", () => {
    const p = previewFor(origin({ mode: "resize-end" }), { minute: 750, dayIndex: 6 }, { dayCount: 7 });
    expect(p.dayIndex).toBe(2);
  });
});

describe("isNoOp", () => {
  it("is true when nothing moved", () => {
    const o = origin();
    expect(isNoOp(o, { startMinute: 600, endMinute: 660, dayIndex: 2 })).toBe(true);
  });

  it("catches a change on any axis", () => {
    const o = origin();
    expect(isNoOp(o, { startMinute: 615, endMinute: 675, dayIndex: 2 })).toBe(false);
    expect(isNoOp(o, { startMinute: 600, endMinute: 675, dayIndex: 2 })).toBe(false);
    expect(isNoOp(o, { startMinute: 600, endMinute: 660, dayIndex: 3 })).toBe(false);
  });

  it("reports a drag that returns to its starting place as a no-op", () => {
    const o = origin();
    const p = previewFor(o, { minute: 600, dayIndex: 2 }, { dayCount: 7 });
    expect(isNoOp(o, p)).toBe(true);
  });
});

describe("canDragMeeting", () => {
  const base = { scheduled_at: "2026-08-26T14:00:00.000Z", status: "waiting", locked_at: null } as Pick<
    CalendarMeeting,
    "scheduled_at" | "status" | "locked_at"
  >;

  it("allows a scheduled, open meeting", () => {
    expect(canDragMeeting(base)).toBe(true);
    expect(canDragMeeting({ ...base, status: "active" })).toBe(true);
  });

  it("refuses one with no time to drag from", () => {
    expect(canDragMeeting({ ...base, scheduled_at: null })).toBe(false);
  });

  it("refuses to rewrite history", () => {
    expect(canDragMeeting({ ...base, status: "ended" })).toBe(false);
    expect(canDragMeeting({ ...base, locked_at: "2026-08-26T10:00:00.000Z" })).toBe(false);
  });
});

describe("formatMinute / describeSpan", () => {
  it("reads as a clock", () => {
    expect(formatMinute(0)).toBe("12:00 AM");
    expect(formatMinute(9 * 60 + 5)).toBe("9:05 AM");
    expect(formatMinute(12 * 60)).toBe("12:00 PM");
    expect(formatMinute(13 * 60 + 30)).toBe("1:30 PM");
    expect(formatMinute(23 * 60 + 45)).toBe("11:45 PM");
  });

  it("renders the far edge of the day as midnight, not 24:00", () => {
    expect(formatMinute(MINUTES_IN_DAY)).toBe("12:00 AM");
  });

  it("labels the span being dragged", () => {
    expect(describeSpan({ startMinute: 615, endMinute: 675, dayIndex: 0 })).toBe("10:15 AM – 11:15 AM");
  });
});

describe("previewStartIso", () => {
  it("resolves to the local wall-clock time the member dropped it on", () => {
    const day = new Date(2026, 7, 26); // 26 Aug 2026, local
    const iso = previewStartIso(day, { startMinute: 10 * 60 + 30, endMinute: 11 * 60 + 30, dayIndex: 0 });
    const back = new Date(iso);
    expect(back.getHours()).toBe(10);
    expect(back.getMinutes()).toBe(30);
    expect(back.getDate()).toBe(26);
  });

  it("ignores any time already on the day object", () => {
    const day = new Date(2026, 7, 26, 17, 42, 13, 500);
    const back = new Date(previewStartIso(day, { startMinute: 60, endMinute: 120, dayIndex: 0 }));
    expect(back.getHours()).toBe(1);
    expect(back.getMinutes()).toBe(0);
    expect(back.getSeconds()).toBe(0);
    expect(back.getMilliseconds()).toBe(0);
  });
});
