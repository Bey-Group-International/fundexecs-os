// Whether a recording part that failed to upload is worth sending again.
//
// The write path was built to make retrying safe — object upserted by path, row
// upserted on (recording_id, idx) — and then never retried. These rules decide
// what to do with that property, and every one of them is about not losing
// footage a host cannot recapture.

import {
  UPLOAD_MAX_ATTEMPTS,
  UPLOAD_RETRY_DELAYS_MS,
  classifyUploadError,
  droppedPartsNotice,
  uploadRetryDelay,
} from "./upload-retry";

describe("what a failed upload means", () => {
  // The case this exists for: a wifi stumble mid-meeting. No status at all,
  // because the request never reached anything.
  it("retries a network failure that never got an answer", () => {
    expect(classifyUploadError(new TypeError("Failed to fetch"))).toBe("retry");
  });

  it("retries storage falling over", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyUploadError({ status })).toBe("retry");
    }
  });

  it("retries being told to slow down, or to try again", () => {
    expect(classifyUploadError({ status: 429 })).toBe("retry");
    expect(classifyUploadError({ status: 408 })).toBe("retry");
  });

  // These are decisions, not accidents. The same bytes sent again get the same
  // answer, and spending three more requests to hear it is pure waste.
  it("gives up on a refusal", () => {
    expect(classifyUploadError({ status: 401 })).toBe("give_up");
    expect(classifyUploadError({ status: 403 })).toBe("give_up");
    expect(classifyUploadError({ status: 413 })).toBe("give_up");
  });

  // Supabase storage reports it either way, and sometimes as a string.
  it("reads the status however the error spells it", () => {
    expect(classifyUploadError({ statusCode: 503 })).toBe("retry");
    expect(classifyUploadError({ statusCode: "403" })).toBe("give_up");
    expect(classifyUploadError({ status: "500" })).toBe("retry");
  });

  // An upload path that gives up on a failure it does not recognise loses
  // footage to a changed error shape. Retrying costs at most three requests.
  it("retries anything it does not recognise, rather than discarding footage", () => {
    expect(classifyUploadError(null)).toBe("retry");
    expect(classifyUploadError("something went wrong")).toBe("retry");
    expect(classifyUploadError({})).toBe("retry");
    expect(classifyUploadError({ status: "not a number" })).toBe("retry");
    expect(classifyUploadError({ message: "boom" })).toBe("retry");
  });
});

describe("how long to keep trying", () => {
  it("waits a moment, then longer, then gives up", () => {
    expect(uploadRetryDelay(0)).toBe(500);
    expect(uploadRetryDelay(1)).toBe(2_000);
    expect(uploadRetryDelay(2)).toBe(5_000);
    expect(uploadRetryDelay(3)).toBeNull();
  });

  // Parts upload in order, and the queue is what makes the stored recording a
  // prefix of the real one. A part that retries for a minute holds up every
  // part behind it, which is a worse failure than the one it is avoiding.
  it("does not hold up the queue for longer than the stumbles worth covering", () => {
    const total = UPLOAD_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(10_000);
  });

  it("counts the first attempt in the total", () => {
    expect(UPLOAD_MAX_ATTEMPTS).toBe(UPLOAD_RETRY_DELAYS_MS.length + 1);
  });

  it("refuses a nonsensical attempt rather than waiting zero and spinning", () => {
    expect(uploadRetryDelay(-1)).toBeNull();
    expect(uploadRetryDelay(Number.NaN)).toBeNull();
  });
});

describe("telling the host what was lost", () => {
  // A clean recording says nothing at all.
  it("says nothing when nothing was lost", () => {
    expect(droppedPartsNotice(0, 5_000)).toBeNull();
    expect(droppedPartsNotice(-1, 5_000)).toBeNull();
    expect(droppedPartsNotice(Number.NaN, 5_000)).toBeNull();
  });

  // Seconds, not parts. "4 chunks" means nothing to somebody deciding whether
  // to hold the meeting again; "about 20 seconds" means everything.
  it("counts in time rather than in parts", () => {
    expect(droppedPartsNotice(4, 5_000)).toContain("about 20 seconds");
    expect(droppedPartsNotice(1, 5_000)).toContain("about 5 seconds");
  });

  it("switches to minutes once seconds stop being useful", () => {
    const notice = droppedPartsNotice(24, 5_000);
    expect(notice).toContain("about 2 minutes");
  });

  it("gets the singular right", () => {
    expect(droppedPartsNotice(1, 1_000)).toContain("about 1 second");
    expect(droppedPartsNotice(12, 5_000)).toContain("about 1 minute");
  });

  // It reports gaps; it does not call the recording broken. What was captured
  // plays, and telling somebody their recording failed when they have a usable
  // file costs them a meeting they did not need to repeat.
  it("does not tell the host their recording failed", () => {
    const notice = droppedPartsNotice(4, 5_000) ?? "";
    expect(notice).toMatch(/rest was saved/i);
    expect(notice).not.toMatch(/\bfailed\b/i);
  });
});
