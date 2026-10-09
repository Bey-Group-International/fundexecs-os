/**
 * copyTextWhenReady: a clipboard write that is STARTED inside the user's
 * gesture and resolved later. Safari refuses `writeText` once an `await` has
 * passed, so the instant-meeting link — known only after the room is created —
 * was never copied there; `ClipboardItem` takes a promise, which is the one
 * shape that survives the wait.
 */
import { copyTextWhenReady } from "./MeetingShareLink";

type Deferred = { promise: Promise<string>; resolve: (v: string) => void; reject: (e: unknown) => void };
function deferred(): Deferred {
  let resolve!: (v: string) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const g = globalThis as { ClipboardItem?: unknown };
const originalItem = g.ClipboardItem;

afterEach(() => {
  g.ClipboardItem = originalItem;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("copyTextWhenReady", () => {
  it("hands the clipboard a promise inside the gesture and resolves once the text lands", async () => {
    const write = jest.fn(async (_items: unknown[]) => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, writeText: jest.fn() } });
    class FakeItem { constructor(public items: Record<string, Promise<Blob>>) {} }
    g.ClipboardItem = FakeItem;

    const d = deferred();
    const result = copyTextWhenReady(d.promise);
    // Called synchronously, before the text exists — that is the whole point.
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as FakeItem;
    expect(item).toBeInstanceOf(FakeItem);

    d.resolve("https://x.test/meeting-invite/abc");
    await expect(result).resolves.toBe(true);
    await expect(item.items["text/plain"].then((b) => b.text())).resolves.toBe("https://x.test/meeting-invite/abc");
  });

  it("falls back to a plain copy of the resolved text where ClipboardItem is missing", async () => {
    const writeText = jest.fn(async (_t: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    g.ClipboardItem = undefined;

    const d = deferred();
    const result = copyTextWhenReady(d.promise);
    expect(writeText).not.toHaveBeenCalled();
    d.resolve("link");
    await expect(result).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("link");
  });

  it("answers false, never throws, when the text never arrives", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: jest.fn() } });
    g.ClipboardItem = undefined;
    const d = deferred();
    const result = copyTextWhenReady(d.promise);
    d.reject(new Error("no room"));
    await expect(result).resolves.toBe(false);
  });
});
