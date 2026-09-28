/**
 * The meeting clock.
 *
 * It used to be a number in MeetingRoom's state, advanced by a one-second
 * interval — so a second hand in the control bar re-rendered every video tile in
 * the call, once a second, for the length of the meeting, on the main thread
 * that decodes the video. Nothing else on screen changed.
 *
 * Two things are pinned here. That the clock reads the room's span bookkeeping
 * rather than counting its own ticks, which is what lets it skip ticks and still
 * be right. And that it takes its state as a REF: a ref object keeps its identity
 * forever, so the parent's props do not change when a second passes — which is
 * the entire point of moving the tick down here.
 *
 * The arithmetic itself is in lib/meetings/elapsed.test.ts.
 */
import { act, render, screen } from "@testing-library/react";
import { MeetingClock } from "./MeetingClock";
import { NO_ELAPSED, startSpan, stopSpan, type ElapsedState } from "@/lib/meetings/elapsed";

function hide(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A ref, as the room hands it over: read by the clock, never written. */
const refTo = (state: ElapsedState) => ({ current: state });

describe("MeetingClock", () => {
  let now = 0;

  beforeEach(() => {
    jest.useFakeTimers();
    now = 0;
    jest.spyOn(performance, "now").mockImplementation(() => now);
    hide("visible");
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows nothing elapsed before the meeting is live", () => {
    render(<MeetingClock elapsed={refTo(NO_ELAPSED)} />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("reads the elapsed time from the ref on each tick", () => {
    const ref = refTo(startSpan(NO_ELAPSED, 0));
    render(<MeetingClock elapsed={ref} />);
    expect(screen.getByText("00:00")).toBeInTheDocument();

    now = 5_000;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("00:05")).toBeInTheDocument();
  });

  it("is right after a tick it never got", () => {
    // The payoff for measuring instead of counting. One interval callback is
    // delivered where sixty were due — a loaded main thread, or a tab the
    // browser throttled — and the clock still shows the real elapsed time
    // rather than 00:01.
    const ref = refTo(startSpan(NO_ELAPSED, 0));
    render(<MeetingClock elapsed={ref} />);

    now = 60_000;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("01:00")).toBeInTheDocument();
  });

  it("stops ticking while the tab is hidden and reads the clock on the way back", () => {
    const ref = refTo(startSpan(NO_ELAPSED, 0));
    render(<MeetingClock elapsed={ref} />);

    now = 2_000;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("00:02")).toBeInTheDocument();

    act(() => { hide("hidden"); });
    now = 400_000;
    act(() => { jest.advanceTimersByTime(60_000); });
    // Asleep: no render happened while nobody was looking.
    expect(screen.getByText("00:02")).toBeInTheDocument();

    // Back, and correct immediately — not on the next tick, and not resuming a
    // count that fell six minutes behind.
    act(() => { hide("visible"); });
    expect(screen.getByText("06:40")).toBeInTheDocument();
  });

  it("does not start a tick at all when mounted on a hidden tab", () => {
    hide("hidden");
    const ref = refTo(startSpan(NO_ELAPSED, 0));
    render(<MeetingClock elapsed={ref} />);

    now = 9_000;
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("holds still once the meeting stops being live", () => {
    // A call that ended, or one whose link dropped. The span is closed, so the
    // total no longer depends on when it is asked.
    const ref = refTo(stopSpan(startSpan(NO_ELAPSED, 0), 30_000));
    render(<MeetingClock elapsed={ref} />);
    expect(screen.getByText("00:30")).toBeInTheDocument();

    now = 10_000_000;
    act(() => { jest.advanceTimersByTime(5_000); });
    expect(screen.getByText("00:30")).toBeInTheDocument();
  });

  it("counts only the stretches the call was live", () => {
    // A call that dropped for fifty seconds and came back is not fifty seconds
    // of meeting.
    let state = startSpan(NO_ELAPSED, 0);
    state = stopSpan(state, 10_000);
    state = startSpan(state, 60_000);
    const ref = refTo(state);

    render(<MeetingClock elapsed={ref} />);
    now = 75_000;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("00:25")).toBeInTheDocument();
  });

  it("grows an hours field rather than showing 60+ minutes", () => {
    // The control bar's old inline mm:ss had no hour case, so a meeting past the
    // hour read "77:03" while the recording clock beside it read "1:17:03".
    const ref = refTo(startSpan(NO_ELAPSED, 0));
    render(<MeetingClock elapsed={ref} />);

    now = 4_623_000;
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("1:17:03")).toBeInTheDocument();
  });

  it("is not read out over the meeting", () => {
    // It changes every second. A screen reader announcing the duration on every
    // tick would talk across the room; the badge is furniture, not news.
    const { container } = render(<MeetingClock elapsed={refTo(NO_ELAPSED)} />);
    expect(container.querySelector("span")).toHaveAttribute("aria-hidden", "true");
  });

  it("stops its interval when unmounted", () => {
    const ref = refTo(startSpan(NO_ELAPSED, 0));
    const { unmount } = render(<MeetingClock elapsed={ref} />);
    const clear = jest.spyOn(global, "clearInterval");
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
