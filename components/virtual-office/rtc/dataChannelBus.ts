/**
 * FundExecs OS — typed data-channel command bus.
 *
 * A small bidirectional RPC + event layer over a WebRTC `RTCDataChannel` (or
 * any string transport). It gives the office a typed way to send commands and
 * await responses across a peer connection — the same shape the Unreal Pixel
 * Streaming path used, generalized so the existing mesh/SFU RTC managers (or a
 * future cloud-render channel) can reuse it.
 *
 * Transport-agnostic by design: the core talks to a `BusTransport` (send a
 * string, receive a string, know if it's open), so it is unit-testable with a
 * loopback pair and has no dependency on `RTCDataChannel` itself. A real channel
 * is wired via `DataChannelBus.forDataChannel`.
 *
 * Wire format (JSON per frame):
 *   { t: "evt", ch, p? }            — fire-and-forget event
 *   { t: "req", ch, id, p? }        — request expecting a response
 *   { t: "res", id, p? | e? }       — response (payload or error string)
 */

/** The minimal transport the bus needs. */
export type BusTransport = {
  send(data: string): void;
  /** Register the single receive callback (the bus sets this on construction). */
  onReceive(cb: (data: string) => void): void;
  isOpen(): boolean;
};

/** A command handler: receives the request payload, returns a response value. */
export type BusHandler = (payload: unknown) => unknown | Promise<unknown>;

type Wire =
  | { t: "evt"; ch: string; p?: unknown }
  | { t: "req"; ch: string; id: string; p?: unknown }
  | { t: "res"; id: string; p?: unknown; e?: string };

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> };

export class DataChannelBus {
  private readonly handlers = new Map<string, BusHandler>();
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private readonly idPrefix: string;

  constructor(private readonly transport: BusTransport, opts: { idPrefix?: string } = {}) {
    this.idPrefix = opts.idPrefix ?? "r";
    transport.onReceive((data) => {
      void this.receive(data);
    });
  }

  /** Register a handler for a command. Returns an unregister function. */
  on(command: string, handler: BusHandler): () => void {
    this.handlers.set(command, handler);
    return () => {
      if (this.handlers.get(command) === handler) this.handlers.delete(command);
    };
  }

  /** Fire-and-forget: send an event with no response expected. */
  emit(command: string, payload?: unknown): void {
    this.transport.send(JSON.stringify({ t: "evt", ch: command, p: payload } satisfies Wire));
  }

  /**
   * Send a request and await the peer's response. Rejects if the peer reports
   * an error, or after `timeoutMs` (0 disables the timeout).
   */
  request<T = unknown>(command: string, payload?: unknown, timeoutMs = 10_000): Promise<T> {
    const id = `${this.idPrefix}-${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`bus request "${command}" timed out`));
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.transport.send(JSON.stringify({ t: "req", ch: command, id, p: payload } satisfies Wire));
    });
  }

  /** Reject all in-flight requests and drop handlers (call on channel close). */
  dispose(reason = "bus disposed"): void {
    for (const [, pend] of this.pending) {
      if (pend.timer) clearTimeout(pend.timer);
      pend.reject(new Error(reason));
    }
    this.pending.clear();
    this.handlers.clear();
  }

  private async receive(data: string): Promise<void> {
    let msg: Wire;
    try {
      msg = JSON.parse(data) as Wire;
    } catch {
      return; // ignore non-JSON frames
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.t === "evt") {
      await this.safeCall(this.handlers.get(msg.ch), msg.p);
      return;
    }
    if (msg.t === "req") {
      const handler = this.handlers.get(msg.ch);
      if (!handler) {
        this.reply({ t: "res", id: msg.id, e: `no handler for "${msg.ch}"` });
        return;
      }
      try {
        const result = await handler(msg.p);
        this.reply({ t: "res", id: msg.id, p: result });
      } catch (err) {
        this.reply({ t: "res", id: msg.id, e: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (msg.t === "res") {
      const pend = this.pending.get(msg.id);
      if (!pend) return;
      this.pending.delete(msg.id);
      if (pend.timer) clearTimeout(pend.timer);
      if (msg.e) pend.reject(new Error(msg.e));
      else pend.resolve(msg.p);
    }
  }

  private async safeCall(handler: BusHandler | undefined, payload: unknown): Promise<void> {
    if (!handler) return;
    try {
      await handler(payload);
    } catch {
      // Event handlers don't report back; swallow so one bad handler can't
      // tear down the receive loop.
    }
  }

  private reply(msg: Wire): void {
    if (this.transport.isOpen()) this.transport.send(JSON.stringify(msg));
  }

  /** Adapt a real `RTCDataChannel` into a bus. */
  static forDataChannel(channel: RTCDataChannel, opts: { idPrefix?: string } = {}): DataChannelBus {
    const transport: BusTransport = {
      send: (data) => {
        if (channel.readyState === "open") channel.send(data);
      },
      onReceive: (cb) => {
        channel.addEventListener("message", (ev: MessageEvent) => {
          if (typeof ev.data === "string") cb(ev.data);
        });
      },
      isOpen: () => channel.readyState === "open",
    };
    return new DataChannelBus(transport, opts);
  }
}
