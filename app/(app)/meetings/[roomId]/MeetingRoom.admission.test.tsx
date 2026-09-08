/**
 * The admission orchestration as MeetingRoom actually wires it.
 *
 * The sequence itself is covered by lib/meetings/admission-session.test.tsx.
 * What is left, and what this pins, is the wiring: that the knock and poll go to
 * the real route with the real parameters, that the verdicts land on the right
 * screens, and that leaving actually stops the session. Wiring is where the
 * shipped bugs were — none of them were mistakes in the sequence.
 *
 * Only two things are stubbed. The green room owns the camera and device
 * pickers, which are its own concern and not under test, so it is replaced by a
 * bare Join button. And the network is faked, because that is the thing being
 * asserted. Everything between them — meeting resolution, the admission
 * session, the screens — is the code that ships.
 *
 * These paths deliberately stop short of being admitted into the room: entering
 * opens a camera, an ICE negotiation and a Realtime channel, and a test that
 * mocked all of that would be testing its own mocks.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams("guest=1&name=Ada"),
}));

// The green room is replaced by the parts of its contract this test needs: the
// join press, the admission state it is handed, and the cancel it is given. The
// screen it renders for those is its own concern and is tested in
// MeetingGreenRoom.admission.test.tsx.
jest.mock("./MeetingGreenRoom", () => ({
  MeetingGreenRoom: ({ onJoin, admission, onCancelAdmission }: {
    onJoin: (c: unknown) => void;
    admission?: string;
    onCancelAdmission?: () => void;
  }) => (
    <div>
      <button onClick={() => onJoin({ cameraId: "", micId: "", speakerId: "", cameraEnabled: false, micEnabled: false, background: null })}>
        Join now
      </button>
      <span data-testid="admission">{admission ?? "idle"}</span>
      {onCancelAdmission && <button onClick={onCancelAdmission}>Cancel wait</button>}
    </div>
  ),
}));

/**
 * Records the channels subscribed to and lets a test fire a broadcast on one,
 * so the guest's Realtime wiring can be driven without a Supabase server.
 */
const realtime = {
  channels: [] as Array<{ name: string; event?: string; handler?: () => void; removed: boolean }>,
  /** Report SUBSCRIBED to the subscriber; false to simulate a socket that never opens. */
  connects: true,
  reset() { this.channels = []; this.connects = true; },
  nudge(name: string) {
    for (const c of this.channels) if (c.name === name && !c.removed) c.handler?.();
  },
};

const supabaseStub = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: () => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b, order: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return b;
  },
  channel: (name: string) => {
    const entry: { name: string; event?: string; handler?: () => void; removed: boolean } = { name, removed: false };
    realtime.channels.push(entry);
    const api = {
      on: (_type: string, filter: { event?: string }, handler: () => void) => {
        entry.event = filter?.event;
        entry.handler = handler;
        return api;
      },
      subscribe: (cb?: (status: string) => void) => {
        cb?.(realtime.connects ? "SUBSCRIBED" : "CHANNEL_ERROR");
        return entry;
      },
    };
    return api;
  },
  removeChannel: (c: { removed: boolean }) => { if (c) c.removed = true; },
};
jest.mock("@/lib/supabase/client", () => ({ createClient: () => supabaseStub }));

import { MeetingRoom } from "./MeetingRoom";

const ROOM = "abc-defg-hi";

/** Records every request, and answers the knock route from a queue of statuses. */
function fakeNetwork(statuses: string[]) {
  const requests: { url: string; method: string; body?: unknown }[] = [];
  const queue = [...statuses];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url.includes("/knock")) {
      const status = queue.length > 1 ? queue.shift()! : queue[0] ?? "waiting";
      return { ok: true, json: async () => ({ status, admissionId: "adm-1" }) } as Response;
    }
    // The public meeting lookup, for a guest with no account.
    if (url.includes("/api/meetings/public/")) {
      return { ok: true, json: async () => ({ id: "m1", title: "Series B Diligence", status: "active" }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return { requests, knocks: () => requests.filter((r) => r.url.includes("/knock")) };
}

beforeEach(() => {
  jest.clearAllMocks();
  realtime.reset();
  window.localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Render the room and press Join, as an invite-link guest would. */
async function joinAsGuest() {
  const view = render(<MeetingRoom roomCode={ROOM} />);
  await userEvent.click(await screen.findByRole("button", { name: /join now/i }));
  return view;
}

/** The guest is on the pre-join screen, waiting — no screen change involved. */
async function waitingForHost() {
  await waitFor(() => expect(screen.getByTestId("admission")).toHaveTextContent("waiting"));
}

describe("a guest knocking", () => {
  it("knocks the meeting's own route, naming itself and its guest key", async () => {
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();

    await waitFor(() => expect(net.knocks().length).toBeGreaterThan(0));
    const knock = net.knocks()[0];
    expect(knock.method).toBe("POST");
    expect(knock.url).toBe(`/api/meetings/public/${ROOM}/knock`);
    const body = knock.body as { guestKey?: string; displayName?: string };
    expect(body.displayName).toBe("Ada");
    expect(typeof body.guestKey).toBe("string");
    expect(body.guestKey).not.toHaveLength(0);
  });

  // The key is what the host's admit is written against; a reload that changed
  // it was the bug that made "Admit" reach nobody.
  it("knocks with the key it persisted for this room", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();

    await waitFor(() => expect(net.knocks().length).toBeGreaterThan(0));
    expect((net.knocks()[0].body as { guestKey?: string }).guestKey).toBe("sticky-key");
  });

  // The point of the redesign: knocking does not change screens. The guest keeps
  // the camera, the toggles and the device pickers they were just looking at.
  it("waits on the pre-join screen rather than moving the guest anywhere", async () => {
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();
    expect(screen.getByRole("button", { name: /join now/i })).toBeInTheDocument();
  });

  // Polling is the floor under the push now, so this is the no-Realtime path:
  // a guest whose socket never opens still asks, and still asks with the key the
  // host's decision was written against.
  it("polls the knock route with that same key when nothing is watching", async () => {
    realtime.connects = false;
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();

    await waitFor(
      () => expect(net.knocks().some((r) => r.method === "GET" && r.url.includes("key=sticky-key"))).toBe(true),
      { timeout: 4000 },
    );
  });

  // The headline of moving to Realtime: a guest whose decision will be pushed
  // should be all but silent while they wait, rather than asking every 1.5s.
  it("barely talks to the server while a push is expected", async () => {
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();
    const afterKnock = net.knocks().length;

    await new Promise((r) => setTimeout(r, 3_000));
    expect(net.knocks().length).toBe(afterKnock);
  }, 10_000);
});

describe("the host's verdict", () => {
  it("turns a denied guest away, without sending them into the signed-in app", async () => {
    fakeNetwork(["denied"]);
    await joinAsGuest();

    expect(await screen.findByRole("heading", { name: /you weren't admitted/i })).toBeInTheDocument();
    expect(screen.queryByText(/waiting for host to admit you/i)).not.toBeInTheDocument();
    // The old bug: router.push("/meetings"), which redirects a guest to /login.
    expect(push).not.toHaveBeenCalledWith("/meetings");
  });

  it("shows a guest out when the meeting has already ended", async () => {
    fakeNetwork(["ended"]);
    await joinAsGuest();

    expect(await screen.findByRole("heading", { name: /thanks for joining/i })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalledWith(`/meetings/${ROOM}/report`);
  });

  it("turns the guest away when the deny arrives on a later poll", async () => {
    // Explicitly the fallback path: with a live subscription the deny would come
    // as a nudge instead, which is covered below.
    realtime.connects = false;
    fakeNetwork(["waiting", "denied"]);
    await joinAsGuest();
    await waitingForHost();

    expect(await screen.findByRole("heading", { name: /you weren't admitted/i }, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("a guest who gives up", () => {
  // The shipped bug: Cancel stopped the timers but left the waiting screen up.
  // Cancelling now returns the guest to the join button on the same screen —
  // their camera and setup intact, one press from asking again.
  it("hands the guest back the join button when Cancel is pressed", async () => {
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();

    await userEvent.click(screen.getByRole("button", { name: /cancel wait/i }));
    await waitFor(() => expect(screen.getByTestId("admission")).toHaveTextContent("idle"));
  });

  it("stops asking the server once it has left", async () => {
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();

    await userEvent.click(screen.getByRole("button", { name: /cancel wait/i }));
    await waitFor(() => expect(screen.getByTestId("admission")).toHaveTextContent("idle"));

    const after = net.knocks().length;
    await new Promise((r) => setTimeout(r, 3_500));
    expect(net.knocks().length).toBe(after);
  }, 10_000);
});

describe("the guest's Realtime subscription", () => {
  it("listens on the channel the server publishes that guest's nudge to", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();

    const sub = realtime.channels.find((c) => c.name === `admission:${ROOM}:sticky-key`);
    expect(sub).toBeDefined();
    expect(sub?.event).toBe("admission");
  });

  // The push says "ask", and the answer still comes from the server. This is the
  // whole trust model in one test: a forged broadcast can only cause a request.
  it("asks the server on a nudge, and acts on what it says", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    const net = fakeNetwork(["waiting", "denied"]);
    await joinAsGuest();
    await waitingForHost();
    const before = net.knocks().length;

    realtime.nudge(`admission:${ROOM}:sticky-key`);

    expect(await screen.findByRole("heading", { name: /you weren't admitted/i })).toBeInTheDocument();
    expect(net.knocks().length).toBeGreaterThan(before);
  });

  it("drops the subscription when the guest leaves", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();

    await userEvent.click(screen.getByRole("button", { name: /cancel wait/i }));
    await waitFor(() => {
      const sub = realtime.channels.find((c) => c.name === `admission:${ROOM}:sticky-key`);
      expect(sub?.removed).toBe(true);
    });
  });

  // A guest whose socket never opens must still get in — the poll is the floor
  // under the push, not an optimisation on top of it.
  it("still gets the guest in when the subscription never connects", async () => {
    realtime.connects = false;
    const net = fakeNetwork(["waiting", "denied"]);
    await joinAsGuest();
    await waitingForHost();

    expect(await screen.findByRole("heading", { name: /you weren't admitted/i }, { timeout: 5_000 })).toBeInTheDocument();
    expect(net.knocks().length).toBeGreaterThan(1);
  }, 10_000);
});

// Navigating away is not the Cancel button, and for a long time nothing tore the
// call down on unmount: the session went on polling behind a page nobody was
// looking at, and now would hold a Realtime subscription open too. This was
// found by an unrelated test seeing requests from a previous one.
describe("a guest who navigates away", () => {
  it("stops asking the server once the page is gone", async () => {
    realtime.connects = false;   // the polling path, so there is traffic to stop
    const net = fakeNetwork(["waiting"]);
    const view = await joinAsGuest();
    await waitingForHost();
    await waitFor(() => expect(net.knocks().length).toBeGreaterThan(1), { timeout: 4_000 });

    view.unmount();
    const after = net.knocks().length;
    await new Promise((r) => setTimeout(r, 3_000));
    expect(net.knocks().length).toBe(after);
  }, 15_000);

  it("drops its Realtime subscription with it", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    fakeNetwork(["waiting"]);
    const view = await joinAsGuest();
    await waitingForHost();
    expect(realtime.channels.find((c) => c.name === `admission:${ROOM}:sticky-key`)?.removed).toBe(false);

    view.unmount();
    await waitFor(() =>
      expect(realtime.channels.find((c) => c.name === `admission:${ROOM}:sticky-key`)?.removed).toBe(true),
    );
  });
});

describe("cancelling a knock, then asking again", () => {
  // Cancelling a wait is not leaving the meeting. Tearing the call down would
  // stop the preview stream the pre-join screen is still showing — blanking the
  // guest's own camera and costing them the setup they just did.
  it("puts the guest back on Join without ending anything else", async () => {
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();

    await userEvent.click(screen.getByRole("button", { name: /cancel wait/i }));
    await waitFor(() => expect(screen.getByTestId("admission")).toHaveTextContent("idle"));

    // Still the pre-join screen — not the thank-you a real leave would show.
    expect(screen.getByRole("button", { name: /join now/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /thanks for joining/i })).not.toBeInTheDocument();
  });

  it("knocks again on a second press, with the same key", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();
    await userEvent.click(screen.getByRole("button", { name: /cancel wait/i }));
    await waitFor(() => expect(screen.getByTestId("admission")).toHaveTextContent("idle"));

    const before = net.knocks().filter((r) => r.method === "POST").length;
    await userEvent.click(screen.getByRole("button", { name: /join now/i }));
    await waitingForHost();

    const posts = net.knocks().filter((r) => r.method === "POST");
    expect(posts.length).toBe(before + 1);
    // Same key, so the host's earlier view of this guest is the same row.
    expect((posts[posts.length - 1].body as { guestKey?: string }).guestKey).toBe("sticky-key");
  });

  it("leaves nothing running from the abandoned knock", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    await waitingForHost();
    await userEvent.click(screen.getByRole("button", { name: /cancel wait/i }));
    await waitFor(() => expect(screen.getByTestId("admission")).toHaveTextContent("idle"));

    const subs = realtime.channels.filter((c) => c.name === `admission:${ROOM}:sticky-key`);
    expect(subs.every((c) => c.removed)).toBe(true);
  });
});
