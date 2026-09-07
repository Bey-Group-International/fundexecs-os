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

// The green room is replaced by the one thing this test needs from it.
jest.mock("./MeetingGreenRoom", () => ({
  MeetingGreenRoom: ({ onJoin }: { onJoin: (c: unknown) => void }) => (
    <button onClick={() => onJoin({ cameraId: "", micId: "", speakerId: "", cameraEnabled: false, micEnabled: false, background: null })}>
      Join now
    </button>
  ),
}));

const supabaseStub = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: () => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b, order: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return b;
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
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
  window.localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  jest.useRealTimers();
});

async function joinAsGuest() {
  render(<MeetingRoom roomCode={ROOM} />);
  await userEvent.click(await screen.findByRole("button", { name: /join now/i }));
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

  it("shows the waiting screen while the host has not decided", async () => {
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    expect(await screen.findByText(/waiting for host to admit you/i)).toBeInTheDocument();
  });

  it("polls the knock route with that same key", async () => {
    window.localStorage.setItem(`fx_guest_key_${ROOM}`, "sticky-key");
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();
    await screen.findByText(/waiting for host to admit you/i);

    await waitFor(
      () => expect(net.knocks().some((r) => r.method === "GET" && r.url.includes("key=sticky-key"))).toBe(true),
      { timeout: 4000 },
    );
  });
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
    fakeNetwork(["waiting", "denied"]);
    await joinAsGuest();
    await screen.findByText(/waiting for host to admit you/i);

    expect(await screen.findByRole("heading", { name: /you weren't admitted/i }, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("a guest who gives up", () => {
  // The shipped bug: Cancel stopped the timers but left the waiting screen up.
  it("leaves the waiting screen when Cancel is pressed", async () => {
    fakeNetwork(["waiting"]);
    await joinAsGuest();
    await screen.findByText(/waiting for host to admit you/i);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/waiting for host to admit you/i)).not.toBeInTheDocument());
  });

  it("stops asking the server once it has left", async () => {
    const net = fakeNetwork(["waiting"]);
    await joinAsGuest();
    await screen.findByText(/waiting for host to admit you/i);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/waiting for host to admit you/i)).not.toBeInTheDocument());

    const after = net.knocks().length;
    await new Promise((r) => setTimeout(r, 3_500));
    expect(net.knocks().length).toBe(after);
  }, 10_000);
});
