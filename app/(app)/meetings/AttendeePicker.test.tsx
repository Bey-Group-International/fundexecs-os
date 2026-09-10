/**
 * The attendee picker.
 *
 * The behaviour these lock down is the reason the picker replaced two free-text
 * boxes: every chip must carry an address. The old boxes accepted "Jane Doe",
 * resolved it against the directory only on save, and — when it matched two
 * people or none — invited nobody while telling the host afterwards. So the
 * cases below are mostly about what CANNOT be added, and about internal vs
 * external being inferred rather than asked.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttendeePicker } from "./AttendeePicker";
import type { SelectedAttendee } from "@/lib/meetings/people";

const DIRECTORY = [
  { email: "ana@fund.test", name: "Ana Member", subtitle: "Partner", source: "member" as const },
  { email: "ben@out.test", name: "Ben Contact", subtitle: "CFO · Acme", source: "contact" as const },
  { email: "cal@old.test", name: "Cal Past", source: "past" as const },
];

function mockDirectory(results = DIRECTORY) {
  global.fetch = jest.fn(async () =>
    ({ ok: true, json: async () => ({ results }) }) as unknown as Response,
  ) as unknown as typeof fetch;
}

/** Render with controlled state, exposing the latest value to assertions. */
function setup(initial: SelectedAttendee[] = []) {
  const state = { value: initial };
  function Harness() {
    const [value, setValue] = (require("react") as typeof import("react")).useState(initial);
    state.value = value;
    return <AttendeePicker value={value} onChange={setValue} />;
  }
  render(<Harness />);
  return state;
}

const box = () => screen.getByRole("combobox");

/** Type, then let the 180ms debounce and its fetch settle. */
async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(box(), text);
  await act(async () => { jest.advanceTimersByTime(200); });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockDirectory();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function user() {
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
}

describe("choosing from the directory", () => {
  it("suggests people and shows which directory each came from", async () => {
    const u = user();
    setup();
    await type(u, "a");
    await waitFor(() => expect(screen.getByText("Ana Member")).toBeInTheDocument());
    expect(screen.getByText("Team")).toBeInTheDocument();
  });

  it("adds the highlighted person on Enter, as an internal attendee", async () => {
    const u = user();
    const state = setup();
    await type(u, "ana");
    await waitFor(() => expect(screen.getByText("Ana Member")).toBeInTheDocument());
    await act(async () => { await u.keyboard("{Enter}"); });
    expect(state.value).toEqual([{ name: "Ana Member", email: "ana@fund.test", type: "internal" }]);
  });

  it("marks a saved contact external — the source decides, not the member", async () => {
    const u = user();
    const state = setup();
    await type(u, "ben");
    await waitFor(() => expect(screen.getByText("Ben Contact")).toBeInTheDocument());
    await act(async () => { await u.keyboard("{Enter}"); });
    expect(state.value[0]).toMatchObject({ email: "ben@out.test", type: "external" });
  });

  it("clears the query after a choice so the next name starts clean", async () => {
    const u = user();
    setup();
    await type(u, "ana");
    await waitFor(() => expect(screen.getByText("Ana Member")).toBeInTheDocument());
    await act(async () => { await u.keyboard("{Enter}"); });
    expect(box()).toHaveValue("");
  });
});

describe("what cannot be added", () => {
  it("refuses a bare name and says why", async () => {
    const u = user();
    const state = setup();
    mockDirectory([]);
    await type(u, "Zara Nobody");
    await act(async () => { await u.keyboard("{Enter}"); });
    expect(state.value).toEqual([]);
    expect(screen.getByText(/can't be invited/i)).toBeInTheDocument();
  });

  it("accepts a full address that is in no directory", async () => {
    const u = user();
    const state = setup();
    mockDirectory([]);
    await type(u, "new@guest.test");
    await act(async () => { await u.keyboard("{Enter}"); });
    expect(state.value).toEqual([{ name: "new@guest.test", email: "new@guest.test", type: "external" }]);
  });

  it("does not add the same person twice", async () => {
    const u = user();
    const state = setup([{ name: "Ana Member", email: "ana@fund.test", type: "internal" }]);
    mockDirectory([]);
    await type(u, "ana@fund.test");
    await act(async () => { await u.keyboard("{Enter}"); });
    expect(state.value).toHaveLength(1);
  });
});

describe("removing", () => {
  it("removes the last chip on Backspace in an empty box", async () => {
    const u = user();
    const state = setup([
      { name: "Ana Member", email: "ana@fund.test", type: "internal" },
      { name: "Ben Contact", email: "ben@out.test", type: "external" },
    ]);
    await act(async () => { box().focus(); await u.keyboard("{Backspace}"); });
    expect(state.value.map((a) => a.email)).toEqual(["ana@fund.test"]);
  });

  it("leaves chips alone when Backspace edits actual text", async () => {
    const u = user();
    const state = setup([{ name: "Ana Member", email: "ana@fund.test", type: "internal" }]);
    await type(u, "xy");
    await act(async () => { await u.keyboard("{Backspace}"); });
    expect(state.value).toHaveLength(1);
    expect(box()).toHaveValue("x");
  });

  it("removes a specific chip from its own button", async () => {
    const u = user();
    const state = setup([
      { name: "Ana Member", email: "ana@fund.test", type: "internal" },
      { name: "Ben Contact", email: "ben@out.test", type: "external" },
    ]);
    await act(async () => { await u.click(screen.getByLabelText("Remove Ana Member")); });
    expect(state.value.map((a) => a.email)).toEqual(["ben@out.test"]);
  });
});

describe("when the directory is unreachable", () => {
  it("still lets a full address be typed in", async () => {
    const u = user();
    const state = setup();
    global.fetch = jest.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await type(u, "someone@else.test");
    await act(async () => { await u.keyboard("{Enter}"); });
    expect(state.value).toEqual([
      { name: "someone@else.test", email: "someone@else.test", type: "external" },
    ]);
  });
});
