/**
 * The call's control bar.
 *
 * What these pin is the reorganisation: the panel is reached by a button per
 * tab rather than one "Copilot" toggle, so each tab keeps its own badge — in
 * particular, unread chat is no longer hidden while someone waits to join —
 * and the controls that do not fit a phone are in More rather than gone.
 *
 * Rendered directly, as HostExitControl and CopilotSidebar are: reaching the
 * bar through MeetingRoom means entering a room.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ControlBar } from "./CallParts";

type Props = React.ComponentProps<typeof ControlBar>;

/**
 * Give the bar a width, so the fold can actually be exercised.
 *
 * jsdom reports every element as zero-sized and has no ResizeObserver, which the
 * bar reads as "not measured yet" and answers by folding nothing — the right
 * answer for a first paint, and useless for a test about folding. This stubs the
 * two things the measurement reads: a ResizeObserver that fires once on observe,
 * and widths.
 *
 * `rowWidth` is the space the feature row has, and every control is `itemWidth`
 * wide. A GROUP is as wide as the controls inside it, which is the part that has
 * to be modelled rather than flattened: an earlier version of this reported every
 * element — button or group alike — as one `itemWidth`, which made the row's four
 * groups look narrower than the eight controls inside them, so the unfoldable
 * portion measured as zero and any arithmetic about it passed. The exact widths
 * do not matter; what matters is the ratio, and the arithmetic itself is tested
 * in lib/meetings/control-bar-fit.test.ts.
 *
 * Controls inside an open menu are left out, because a `position: fixed` menu
 * takes no room in the row it hangs off.
 */
/** The row's width right now, so a test can narrow it between measurements. */
let rowWidthNow = 0;

function measureBarAs(rowWidth: number, itemWidth = 48, wide: Record<string, number> = {}) {
  rowWidthNow = rowWidth;
  const controlsIn = (el: HTMLElement) =>
    [...el.querySelectorAll("button")].filter((b) => !b.closest('[role="menu"]'));
  // `wide` makes one named control a multiple of the others' width, which is what
  // a label on a wide screen does to it ("Background" against "Chat"). The
  // multiples used in tests are exaggerated, because what is being pinned is which
  // width the arithmetic fits to, not any real button's measurements.
  const widthOf = (b: Element) => (wide[b.getAttribute("data-bar-feature") ?? ""] ?? 1) * itemWidth;

  (globalThis as Record<string, unknown>).ResizeObserver = class {
    constructor(private readonly cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      const controls = controlsIn(this);
      // A control reports its own width; anything containing controls reports
      // theirs. Reporting a flat `itemWidth` for a leaf was its own bug: the
      // groups then measured wider than the sum of the controls inside them, so
      // the unfoldable portion came out inflated and the widest control came out
      // as the narrowest.
      return controls.length === 0 ? widthOf(this) : controls.reduce((w, b) => w + widthOf(b), 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.querySelector("[data-bar-feature]") ? rowWidthNow : itemWidth;
    },
  });
}

/** Narrow the row without re-rendering, for a test about re-measuring. */
function narrowRowTo(width: number) {
  rowWidthNow = width;
}

/** Resize the window, which is how the share breakpoint is crossed. */
function viewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  act(() => { window.dispatchEvent(new Event("resize")); });
}

afterEach(() => {
  for (const prop of ["offsetWidth", "clientWidth"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 0 });
  }
  delete (globalThis as Record<string, unknown>).ResizeObserver;
  // jsdom's default, which `wideEnough` reads when there is no matchMedia.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
});

function setup(over: Partial<Props> = {}) {
  const handlers = {
    onToggleMic: jest.fn(), onToggleCam: jest.fn(), onToggleScreen: jest.fn(), onOpenPanel: jest.fn(),
    onLeave: jest.fn(), onEndForAll: jest.fn(), onSwitchMic: jest.fn(), onSwitchCam: jest.fn(),
    onSwitchSpeaker: jest.fn(), onRaiseHand: jest.fn(), onReaction: jest.fn(), onMuteAll: jest.fn(),
    onToggleLayout: jest.fn(), onFlipCamera: jest.fn(), onOpenBackgrounds: jest.fn(), onToggleRecording: jest.fn(),
  };
  const { container } = render(
    <ControlBar
      micOn camOn shareOn={false} shareStarting={false} isHost={false} handRaised={false}
      panel={null} canShareDocs participantCount={3}
      handsUp={0} handsUpNote="" layout="grid" layoutForced={false} chatUnread={0} waitingCount={0}
      elapsed={{ current: { spans: [], openedAt: null } }}
      roomCode="abc-defg-hij" bwMode="normal" activeMicId="" activeCamId="" camStarting={false}
      leaving={false} backgroundActive={false} backgroundBtnRef={{ current: null }}
      recordingState="idle" recordingBy="" recordingStartedAt={null}
      {...handlers}
      {...over}
    />,
  );
  return { ...handlers, container, user: userEvent.setup() };
}

describe("the panel buttons", () => {
  it("opens the panel on the tab each one names", async () => {
    const { onOpenPanel, user } = setup();
    await user.click(screen.getByRole("button", { name: "Chat" }));
    await user.click(screen.getByRole("button", { name: /^People/ }));
    await user.click(screen.getByRole("button", { name: "Documents" }));
    expect(onOpenPanel.mock.calls).toEqual([["chat"], ["people"], ["docs"]]);
  });

  it("no longer calls anything Copilot", () => {
    setup();
    expect(screen.queryByText(/copilot/i)).not.toBeInTheDocument();
  });

  it("shows unread chat while someone is waiting to join", () => {
    setup({ isHost: true, chatUnread: 4, waitingCount: 2 });
    expect(screen.getByRole("button", { name: "Chat, 4 unread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "People, 2 waiting to join" })).toBeInTheDocument();
  });

  it("drops the unread badge while the chat is the tab showing", () => {
    setup({ chatUnread: 4, panel: "chat" });
    const chat = screen.getByRole("button", { name: "Chat" });
    expect(chat).toHaveAttribute("aria-pressed", "true");
    expect(within(chat).queryByText("4")).not.toBeInTheDocument();
  });

  it("offers a guest no Documents button", () => {
    setup({ canShareDocs: false });
    expect(screen.queryByRole("button", { name: "Documents" })).not.toBeInTheDocument();
  });

  it("says how many are in the call when nobody is waiting", () => {
    setup({ participantCount: 5 });
    expect(screen.getByRole("button", { name: "People, 5 in the call" })).toBeInTheDocument();
  });
});

describe("the microphone and camera", () => {
  it("are named by what pressing them does, not by a guess from their state", () => {
    setup({ micOn: false, micTitle: "No microphone — retry", camOn: false, camTitle: "No camera — retry" });
    expect(screen.getByRole("button", { name: "No microphone — retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No camera — retry" })).toBeInTheDocument();
  });
});

describe("More", () => {
  it("holds the host's Mute everyone and the invite link", async () => {
    const { onMuteAll, user } = setup({ isHost: true });
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menuitem", { name: /copy invite link/i })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /mute everyone/i }));
    expect(onMuteAll).toHaveBeenCalled();
    // Acting from the menu closes it: it portals over the ending overlay.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not offer a guest the host's tools", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByRole("menuitem", { name: /mute everyone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /record/i })).not.toBeInTheDocument();
  });

  it("anchors the background picker to More when it is opened from there", async () => {
    // Backgrounds only live in More once the bar is too narrow to hold them, so
    // the bar is given a width that folds them there.
    measureBarAs(200);
    const ref: { current: HTMLButtonElement | null } = { current: null };
    const { onOpenBackgrounds, user } = setup({ backgroundBtnRef: ref });
    const more = screen.getByRole("button", { name: "More options" });
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: /background effects/i }));
    expect(onOpenBackgrounds).toHaveBeenCalled();
    expect(ref.current).toBe(more);
  });
});

/**
 * Controls that do not fit.
 *
 * Every bar button is `shrink-0` and the row is `justify-center` with no
 * scrolling, so before this they did not compress, wrap or scroll — they hung off
 * BOTH ends of the bar, past the window edge, where nothing could be clicked.
 * Centring is why it lost them at both ends at once.
 *
 * The arithmetic is tested in lib/meetings/control-bar-fit.test.ts. These pin the
 * wiring: that the bar measures itself at all, that a folded control is still
 * reachable, and that folding one does not take its badge with it.
 */
describe("a bar too narrow for its controls", () => {
  it("keeps every control reachable, moving the surplus into More", async () => {
    measureBarAs(200);
    const { onOpenPanel, user } = setup();

    // Gone from the bar...
    expect(screen.queryByRole("button", { name: /^Grid|^Speaker/ })).not.toBeInTheDocument();
    // ...and still reachable.
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("menuitem", { name: /grid view|speaker view/i }));
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  /**
   * Every control is in exactly one place at a given width, and the two halves
   * cannot disagree because one decision makes both.
   *
   * Read through `data-fold` rather than through what is on screen, because
   * jsdom applies no CSS: a control the bar still has keeps a twin in the menu
   * marked "mirror", which a breakpoint shows only at the widths that hide its
   * button. What must never coexist is a bar button and a twin marked "folded" —
   * that twin is unconditional, so the pair really would be offered twice.
   */
  it("offers no control twice on one screen", async () => {
    measureBarAs(320);
    const { user } = setup({ isHost: true });
    await user.click(screen.getByRole("button", { name: "More options" }));
    const menu = screen.getByRole("menu");

    const onBar = screen
      .queryAllByRole("button")
      .filter((b) => !menu.contains(b) && b.getAttribute("data-bar-feature"))
      .map((b) => b.getAttribute("data-bar-feature"));
    const folded = [...menu.querySelectorAll('[data-fold="folded"]')].map((el) => el.getAttribute("data-bar-feature"));
    const mirrored = [...menu.querySelectorAll('[data-fold="mirror"]')].map((el) => el.getAttribute("data-bar-feature"));

    // The bar is narrow, so something had to fold — otherwise the rest of this
    // asserts nothing.
    expect(folded.length).toBeGreaterThan(0);
    for (const f of folded) expect(onBar).not.toContain(f);
    // And the other way: a control still on the bar has a twin, and that twin is
    // the kind a breakpoint hides.
    for (const f of onBar) expect(mirrored).toContain(f);
  });

  /**
   * The one that matters most. Unread chat and somebody waiting at the door are
   * the reasons to look at the bar; a control that keeps its number only while it
   * happens to have a button goes quiet exactly when the bar is most crowded.
   */
  it("carries a folded control's badge onto More", async () => {
    measureBarAs(60);
    setup({ chatUnread: 4, waitingCount: 2 });
    expect(screen.queryByRole("button", { name: "Chat, 4 unread" })).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "More options" });
    expect(more.textContent).toContain("6");
  });

  it("keeps the whole bar when there is room for it", () => {
    measureBarAs(4000);
    setup({ isHost: true });
    for (const name of [/^Chat$/, /^People/, /^Share$/, /Background/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  /**
   * The whole reason the row is measured rather than read off a breakpoint. A
   * row 500px wide looks like room for ten 48px controls until you notice that
   * the mic, the camera, their two chevrons, More and the exit have already
   * taken about 300px of it — and those six cannot fold to make room. Counting
   * the row's width alone is how controls ended up drawn past the window edge in
   * the first place.
   */
  it("counts only the room the controls that cannot fold have left", async () => {
    measureBarAs(500);
    const { user } = setup();

    // Three or so optional controls fit in what is left, so the deliberate ones
    // give up their buttons even though the row is far from narrow.
    for (const name of [/^Grid$|^Speaker$/, /^React$/, /^Docs$/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    // The two carrying live numbers keep theirs.
    expect(screen.getByRole("button", { name: /^Chat$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^People/ })).toBeInTheDocument();
    // And nothing was lost on the way: what left the bar is in the menu.
    await user.click(screen.getByRole("button", { name: "More options" }));
    const menu = screen.getByRole("menu");
    for (const name of [/grid view|speaker view/i, /^Documents$/]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  /**
   * Fitted to the WIDEST control, not the average of them.
   *
   * Controls are not all one width — at `xl` they gain text labels, so
   * "Background" is wider than "Chat" — and an average over-fills by however
   * much the widest exceeds it, which puts a control back off the edge the fold
   * exists to pull it in from. Asserted as the property rather than as a
   * capacity, because the property is the thing: what is still on the bar has to
   * fit inside the bar. Erring one control too few costs a press; erring the
   * other way costs reachability.
   */
  it("keeps nothing that does not fit, even when one control is far wider than the rest", () => {
    measureBarAs(732, 48, { background: 6 });
    setup();

    const row = screen.getByRole("button", { name: "More options" }).closest("[class*='flex-1']");
    expect(row).not.toBeNull();
    const used = [...row!.children].reduce((w, el) => w + (el as HTMLElement).offsetWidth, 0);
    expect(used).toBeLessThanOrEqual(732);
    // And it really was the wide one that had to go, not a measurement that
    // happened to fold everything.
    expect(screen.queryByRole("button", { name: /Background/ })).not.toBeInTheDocument();
  });

  it("never folds the mic, the camera or the way out", () => {
    measureBarAs(40);
    setup();
    expect(screen.getByRole("button", { name: /mute|unmute/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /camera off|camera on|stop video|start video/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument();
  });

  /**
   * Crossing the share breakpoint has to re-measure, not just re-render.
   *
   * CodeRabbit's finding on this PR, and it was right. At `sm` three things move
   * at once: screen share is offered or withdrawn, every button goes from 42px to
   * 40px, and the mic and camera chevrons appear — so both the width of one
   * control and the width of the part that cannot fold change. The measurement is
   * kept up to date by a ResizeObserver on the row, which only fires when the
   * ROW's own box changes; the row sits between two columns whose contents also
   * change at `sm`, so there are widths where everything inside it resizes and
   * its box does not. The capacity measured on the wide side then keeps more
   * controls than the narrow bar can hold, which is the fault this whole change
   * exists to fix.
   *
   * The stub observer only answers when `observe` is called, so the only way a
   * second measurement happens here is the effect re-running — which is exactly
   * what the dependency controls.
   */
  it("re-measures when the screen crosses the share breakpoint", () => {
    measureBarAs(4000);
    setup();
    expect(screen.getByRole("button", { name: /^Share$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Chat$/ })).toBeInTheDocument();

    narrowRowTo(120);
    viewportWidth(420);

    // Share is gone because a phone cannot share...
    expect(screen.queryByRole("button", { name: /^Share$/ })).not.toBeInTheDocument();
    // ...and the fold measured the narrow row rather than keeping a capacity
    // worked out on a 4000px one.
    expect(screen.queryByRole("button", { name: /^Chat$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More options" })).toBeInTheDocument();
  });

  /**
   * WHAT THESE DO NOT GUARD. Two parts of the measurement survive being broken
   * with every test above still green, and both are named rather than quietly
   * counted as covered.
   *
   * The 6px-per-control gap allowance: setting it to zero changes nothing any
   * test can see, because it only moves the boundary by one control at particular
   * widths. It is a margin, not a rule, and a test pinning it would restate the
   * constant rather than check anything.
   *
   * The synchronous `measure()` before the ResizeObserver is attached: removing
   * it passes here because the stub's `observe()` calls back immediately — and so
   * does a real ResizeObserver, which delivers an initial observation on observe.
   * So it is defence against an environment that does not, and no test in jsdom
   * can tell the two apart. It is held by reading.
   */
});
