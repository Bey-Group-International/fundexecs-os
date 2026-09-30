/**
 * Where an unsent draft belongs on the inbox board.
 *
 * Both rules here exist for one property of the board's own query: it reads 100
 * threads ordered by priority then recency, and a thread created to hold a meeting
 * follow-up has neither — priority 0, no messages. So it sorts to the very bottom,
 * or off the page. The one thread somebody was told to go and act on would be the
 * one they could not see.
 */
import {
  DRAFT_LIMIT,
  draftOrigin,
  draftsFirst,
  missingDraftThreadIds,
  shouldClearDraft,
  type ThreadDraft,
} from "./drafts";

function draft(over: Partial<ThreadDraft> = {}): ThreadDraft {
  return {
    threadId: "t1",
    body: "Hi Ana,",
    source: "meeting_follow_up",
    sourceMeetingId: "m1",
    updatedAt: "2026-09-30T12:00:00.000Z",
    ...over,
  };
}

describe("which draft threads the page read missed", () => {
  it("names the ones that are not on the page", () => {
    expect(
      missingDraftThreadIds({ draftThreadIds: ["a", "b", "c"], onPage: ["b"], filtered: false }),
    ).toEqual(["a", "c"]);
  });

  it("asks for nothing when they are all already there", () => {
    expect(
      missingDraftThreadIds({ draftThreadIds: ["a", "b"], onPage: ["a", "b"], filtered: false }),
    ).toEqual([]);
  });

  it("does not ask for the same thread twice", () => {
    expect(
      missingDraftThreadIds({ draftThreadIds: ["a", "a"], onPage: [], filtered: false }),
    ).toEqual(["a"]);
  });

  /**
   * The rule rather than an omission. Pulling a thread into a search for "acme"
   * because it happens to hold a draft would make the filter a suggestion — and
   * the operator who filtered to "unread only" would be shown a read thread with
   * no explanation.
   */
  it("asks for nothing at all while a filter is active", () => {
    expect(
      missingDraftThreadIds({ draftThreadIds: ["a", "b"], onPage: [], filtered: true }),
    ).toEqual([]);
  });
});

describe("the order they come back in", () => {
  const items = [
    { id: "1", draft: null },
    { id: "2", draft: draft() },
    { id: "3", draft: null },
    { id: "4", draft: draft() },
  ];

  it("puts the threads carrying a draft first", () => {
    expect(draftsFirst(items, (i) => i.draft !== null).map((i) => i.id)).toEqual([
      "2",
      "4",
      "1",
      "3",
    ]);
  });

  /**
   * Stable within each group, so the board's own ordering — priority, then
   * recency — still decides the order of the drafts among themselves and of
   * everything below them. An unstable sort here would silently replace the
   * triage ranking the whole board is built on.
   */
  it("leaves the existing order alone within each group", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      draft: i % 3 === 0 ? draft() : null,
    }));
    const sorted = draftsFirst(many, (i) => i.draft !== null);
    expect(sorted.filter((i) => i.draft).map((i) => i.id)).toEqual(["0", "3", "6"]);
    expect(sorted.filter((i) => !i.draft).map((i) => i.id)).toEqual(["1", "2", "4", "5", "7"]);
  });

  it("changes nothing when no thread has a draft", () => {
    const plain = [{ id: "1" }, { id: "2" }];
    expect(draftsFirst(plain, () => false)).toEqual(plain);
  });
});

describe("what the composer says about it", () => {
  // The sentence that matters, in the one place a pre-filled composer needs it:
  // a paragraph somebody else wrote, with no explanation, reads as already sent.
  it("says nothing has been sent, for a meeting follow-up", () => {
    expect(draftOrigin(draft())).toMatch(/Nothing has been sent/);
    expect(draftOrigin(draft())).toMatch(/meeting report/i);
  });

  // The column is CHECK-constrained to one value today. An unrecognised source
  // must still produce a sentence rather than "undefined" above the composer.
  it("still says something for a source it does not recognise", () => {
    expect(draftOrigin(draft({ source: "something_later" }))).toMatch(/unsent draft/i);
  });
});

describe("the ceiling", () => {
  // A guard against a pathological org, not a page: drafts are one per thread and
  // written deliberately.
  it("is a bound the read can apply", () => {
    expect(DRAFT_LIMIT).toBeGreaterThan(0);
  });
});

/**
 * When a thread action takes the draft with it.
 *
 * A draft of a message that has already gone out is the one state this must not
 * leave behind: it sits in the composer inviting somebody to send it a second
 * time. The narrowing matters just as much in the other direction — firing a
 * suggested action from the card must not silently delete a follow-up nobody has
 * sent.
 */
describe("whether an action clears the draft", () => {
  it("does, for an inline reply that carries text", () => {
    expect(shouldClearDraft("send_reply", "Hi Ana,")).toBe(true);
  });

  it.each(["propose_meeting", "confirm_booking", "create_video_meeting", "share_materials"])(
    "does not, for %s on the same thread",
    (action) => {
      expect(shouldClearDraft(action, "Hi Ana,")).toBe(false);
    },
  );

  // A suggested `send_reply` fired from the card carries no composed text — the
  // dispatcher writes its own. Clearing on that would delete a draft the operator
  // had not looked at.
  it.each([undefined, null, "", "   "])("does not, when the body is %p", (body) => {
    expect(shouldClearDraft("send_reply", body)).toBe(false);
  });
});
