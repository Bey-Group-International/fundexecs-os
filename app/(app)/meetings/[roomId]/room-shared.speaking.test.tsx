/**
 * The speaking store, which is the part of "stop the room re-rendering" that a
 * test can actually hold.
 *
 * The saving itself is a render count, and a leaf that skips a render writes
 * nothing to the DOM either way — so no assertion from outside React can see it,
 * and the numbers live in the pull request with a Profiler. But the property the
 * saving rests on is not a render count at all: it is that publishing a set
 * wakes only the ids whose answer moved. That is plain logic about listeners, and
 * counting calls on it is exact.
 *
 * So the store is tested here, and it is the one place in this pass where the
 * efficiency claim has a real guard rather than a disclosure.
 */
import { render, screen, act } from "@testing-library/react";
import { createSpeakingStore, SpeakingProvider, useSpeaking } from "./room-shared";

describe("createSpeakingStore", () => {
  it("answers for whoever is in the set it was given", () => {
    const store = createSpeakingStore();
    expect(store.get("ada")).toBe(false);

    store.publish(new Set(["ada"]));
    expect(store.get("ada")).toBe(true);
    expect(store.get("brett")).toBe(false);
  });

  it("tells a subscriber when their own answer changes", () => {
    const store = createSpeakingStore();
    const woken: string[] = [];
    store.subscribe("ada", () => woken.push("ada"));

    store.publish(new Set(["ada"]));
    expect(woken).toEqual(["ada"]);

    store.publish(new Set());
    expect(woken).toEqual(["ada", "ada"]);
  });

  // The whole point. One voice in a room of twenty-six used to re-render the
  // room; it must now cost the one person whose ring changed.
  it("leaves everyone else alone when one person starts talking", () => {
    const store = createSpeakingStore();
    const woken: string[] = [];
    for (const id of ["ada", "brett", "carla", "dev"]) {
      store.subscribe(id, () => woken.push(id));
    }

    store.publish(new Set(["brett"]));
    expect(woken).toEqual(["brett"]);
  });

  it("wakes only the two people a handover moved", () => {
    const store = createSpeakingStore();
    const woken: string[] = [];
    for (const id of ["ada", "brett", "carla", "dev"]) {
      store.subscribe(id, () => woken.push(id));
    }
    store.publish(new Set(["brett"]));
    woken.length = 0;

    // Brett stops, Carla starts. Ada and Dev were not in either set and have
    // nothing to redraw.
    store.publish(new Set(["carla"]));
    expect(woken.sort()).toEqual(["brett", "carla"]);
  });

  // Republishing the same answer is the common case: the meter publishes on
  // every 120ms tick, and most of those say exactly what the last one said.
  it("says nothing when a publish changes nobody's answer", () => {
    const store = createSpeakingStore();
    const woken: string[] = [];
    for (const id of ["ada", "brett"]) store.subscribe(id, () => woken.push(id));
    store.publish(new Set(["ada"]));
    woken.length = 0;

    for (let i = 0; i < 80; i++) store.publish(new Set(["ada"]));
    expect(woken).toEqual([]);
  });

  it("stops waking a listener that unsubscribed", () => {
    const store = createSpeakingStore();
    const woken: string[] = [];
    const off = store.subscribe("ada", () => woken.push("ada"));

    store.publish(new Set(["ada"]));
    expect(woken).toHaveLength(1);

    off();
    store.publish(new Set());
    store.publish(new Set(["ada"]));
    expect(woken).toHaveLength(1);
  });

  // A long call admits people and removes them. A listener map that only ever
  // grows is a leak with extra steps, so the last unsubscribe drops the id.
  it("keeps answering correctly after everyone has come and gone", () => {
    const store = createSpeakingStore();
    const offs = ["ada", "brett"].map((id) => store.subscribe(id, () => {}));
    offs.forEach((off) => off());

    store.publish(new Set(["ada"]));
    expect(store.get("ada")).toBe(true);
    expect(store.get("brett")).toBe(false);
  });
});

describe("useSpeaking", () => {
  function Dot({ id, fallback }: { id: string; fallback: boolean }) {
    const speaking = useSpeaking(id, fallback);
    return <span data-testid={id}>{speaking ? "talking" : "quiet"}</span>;
  }

  it("reads the provided store rather than the fallback", () => {
    const store = createSpeakingStore();
    store.publish(new Set(["ada"]));

    render(
      <SpeakingProvider value={store}>
        <Dot id="ada" fallback={false} />
        <Dot id="brett" fallback />
      </SpeakingProvider>,
    );

    expect(screen.getByTestId("ada")).toHaveTextContent("talking");
    // The store is the authority once there is one: brett's `fallback` of true
    // must not override it, or the room and its own tests would disagree.
    expect(screen.getByTestId("brett")).toHaveTextContent("quiet");
  });

  it("re-renders on a publish, without anything above it changing", () => {
    const store = createSpeakingStore();
    render(
      <SpeakingProvider value={store}>
        <Dot id="ada" fallback={false} />
      </SpeakingProvider>,
    );
    expect(screen.getByTestId("ada")).toHaveTextContent("quiet");

    act(() => { store.publish(new Set(["ada"])); });
    expect(screen.getByTestId("ada")).toHaveTextContent("talking");

    act(() => { store.publish(new Set()); });
    expect(screen.getByTestId("ada")).toHaveTextContent("quiet");
  });

  /**
   * An empty id means there is nobody to watch, so the fallback answers even
   * though a store is right there.
   *
   * This is the assertion that was missing, and its absence is why the first
   * version of this shipped with a contract it did not keep. `useSpeaking` read
   * `source.get(id)` whenever a source existed, so an id of "" asked the store
   * about a participant that cannot exist and got `false` forever — while
   * VideoTile's own documentation promised that a tile without `watchId` falls
   * back to its `speaking` prop. Every call site in the room passes `watchId`,
   * so nothing was visibly broken; the next caller would have been.
   */
  it("falls back to the prop for an empty id even inside a provider", () => {
    const store = createSpeakingStore();
    store.publish(new Set(["ada"]));

    render(
      <SpeakingProvider value={store}>
        <Dot id="" fallback />
      </SpeakingProvider>,
    );

    expect(screen.getByTestId("")).toHaveTextContent("talking");
  });

  /**
   * With no provider the fallback is the answer, which is what keeps VideoTile
   * and the sidebar's rows renderable on their own with a plain boolean —
   * MeetingRoom.tile.test.tsx and CallParts.sidebar.test.tsx both do that, and
   * they are the reason this path exists rather than being a convenience.
   */
  it("falls back to the prop when nobody provides a store", () => {
    render(
      <>
        <Dot id="ada" fallback />
        <Dot id="brett" fallback={false} />
      </>,
    );
    expect(screen.getByTestId("ada")).toHaveTextContent("talking");
    expect(screen.getByTestId("brett")).toHaveTextContent("quiet");
  });
});
