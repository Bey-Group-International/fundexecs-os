import { DataChannelBus, type BusTransport } from "./dataChannelBus";

/** A loopback pair of transports that deliver to each other asynchronously. */
function loopback(): { a: BusTransport; b: BusTransport } {
  let aRecv: ((d: string) => void) | null = null;
  let bRecv: ((d: string) => void) | null = null;
  const a: BusTransport = {
    send: (d) => queueMicrotask(() => bRecv?.(d)),
    onReceive: (cb) => {
      aRecv = cb;
    },
    isOpen: () => true,
  };
  const b: BusTransport = {
    send: (d) => queueMicrotask(() => aRecv?.(d)),
    onReceive: (cb) => {
      bRecv = cb;
    },
    isOpen: () => true,
  };
  return { a, b };
}

describe("DataChannelBus request/response", () => {
  it("routes a request to the peer's handler and resolves with its result", async () => {
    const { a, b } = loopback();
    const busA = new DataChannelBus(a, { idPrefix: "a" });
    const busB = new DataChannelBus(b, { idPrefix: "b" });
    busB.on("add", (p) => {
      const { x, y } = p as { x: number; y: number };
      return x + y;
    });
    await expect(busA.request<number>("add", { x: 2, y: 3 })).resolves.toBe(5);
  });

  it("supports async handlers", async () => {
    const { a, b } = loopback();
    const busA = new DataChannelBus(a);
    const busB = new DataChannelBus(b);
    busB.on("echo", async (p) => {
      await Promise.resolve();
      return p;
    });
    await expect(busA.request("echo", "hi")).resolves.toBe("hi");
  });

  it("rejects when the handler throws, propagating the message", async () => {
    const { a, b } = loopback();
    const busA = new DataChannelBus(a);
    const busB = new DataChannelBus(b);
    busB.on("boom", () => {
      throw new Error("kaboom");
    });
    await expect(busA.request("boom")).rejects.toThrow("kaboom");
  });

  it("rejects when the peer has no handler", async () => {
    const { a, b } = loopback();
    const busA = new DataChannelBus(a);
    new DataChannelBus(b); // peer exists but registers nothing
    await expect(busA.request("missing")).rejects.toThrow(/no handler/);
  });

  it("times out when there is no delivery", async () => {
    const dropped: BusTransport = { send: () => {}, onReceive: () => {}, isOpen: () => true };
    const bus = new DataChannelBus(dropped);
    await expect(bus.request("x", undefined, 20)).rejects.toThrow(/timed out/);
  });
});

describe("DataChannelBus events", () => {
  it("delivers fire-and-forget events to the peer handler", async () => {
    const { a, b } = loopback();
    const busA = new DataChannelBus(a);
    const busB = new DataChannelBus(b);
    const seen: unknown[] = [];
    busB.on("ping", (p) => {
      seen.push(p);
    });
    busA.emit("ping", { n: 1 });
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(seen).toEqual([{ n: 1 }]);
  });

  it("unregister stops delivery", async () => {
    const { a, b } = loopback();
    const busA = new DataChannelBus(a);
    const busB = new DataChannelBus(b);
    const seen: unknown[] = [];
    const off = busB.on("ping", (p) => seen.push(p));
    off();
    busA.emit("ping", 1);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(seen).toEqual([]);
  });
});

describe("DataChannelBus dispose", () => {
  it("rejects in-flight requests", async () => {
    const dropped: BusTransport = { send: () => {}, onReceive: () => {}, isOpen: () => true };
    const bus = new DataChannelBus(dropped);
    const p = bus.request("x", undefined, 0); // no timeout
    bus.dispose("closed");
    await expect(p).rejects.toThrow("closed");
  });

  it("ignores malformed frames without throwing", async () => {
    let recv: ((d: string) => void) | null = null;
    const t: BusTransport = { send: () => {}, onReceive: (cb) => (recv = cb), isOpen: () => true };
    new DataChannelBus(t);
    expect(() => recv!("not json {")).not.toThrow();
  });
});
