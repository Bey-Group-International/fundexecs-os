type AnyFn = (...args: any[]) => any;
import type { Device } from "mediasoup-client";
import type {
  SfuGetCapsMessage,
  SfuCreateTransportMessage,
  SfuConnectTransportMessage,
  SfuProduceMessage,
  SfuGetProducersMessage,
  SfuConsumeMessage,
  SfuResumeConsumerMessage,
  SfuLeaveMessage,
  SfuRouterCapsMessage,
  SfuTransportCreatedMessage,
  SfuProducedMessage,
  SfuProducersListMessage,
  SfuConsumedMessage,
  SfuNewProducerMessage,
  SfuProducerClosedMessage,
} from "../net/messages";

type SfuClientMessage =
  | SfuGetCapsMessage
  | SfuCreateTransportMessage
  | SfuConnectTransportMessage
  | SfuProduceMessage
  | SfuGetProducersMessage
  | SfuConsumeMessage
  | SfuResumeConsumerMessage
  | SfuLeaveMessage;

type SendFn = (msg: SfuClientMessage) => void;
type VideoChangeHandler = (peerId: string, el: HTMLVideoElement | null) => void;

interface PeerStreams {
  audioEl: HTMLAudioElement | null;
  videoEl: HTMLVideoElement | null;
}

type AnyObj = any;

export class SfuManager {
  private device: Device | null = null;
  private sendTransport: AnyObj = null;
  private recvTransport: AnyObj = null;
  private audioProducer: AnyObj = null;
  private videoProducer: AnyObj = null;
  private consumers = new Map<string, AnyObj>(); // consumerId → consumer
  private peerStreams = new Map<string, PeerStreams>(); // peerId → streams
  private localStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private gainNodes = new Map<string, GainNode>(); // peerId → gainNode

  // Pending promises: server responses are matched by buffering resolvers
  private pendingCaps: ((caps: unknown) => void) | null = null;
  private pendingSendTransport: ((info: SfuTransportCreatedMessage) => void) | null = null;
  private pendingRecvTransport: ((info: SfuTransportCreatedMessage) => void) | null = null;
  private pendingProduce = new Map<string, (producerId: string) => void>(); // kind → resolver
  private pendingConsume = new Map<string, (info: SfuConsumedMessage) => void>(); // producerId → resolver
  private pendingProducersList: ((list: SfuProducersListMessage["producers"]) => void) | null = null;

  constructor(
    private readonly send: SendFn,
    private readonly onVideoChange: VideoChangeHandler
  ) {}

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
  }

  // ── Handle inbound SFU server messages ───────────────────────────────────────

  handleRouterCaps(msg: SfuRouterCapsMessage): void {
    this.pendingCaps?.(msg.rtpCapabilities);
    this.pendingCaps = null;
  }

  handleTransportCreated(msg: SfuTransportCreatedMessage): void {
    if (msg.direction === "send") {
      this.pendingSendTransport?.(msg);
      this.pendingSendTransport = null;
    } else {
      this.pendingRecvTransport?.(msg);
      this.pendingRecvTransport = null;
    }
  }

  handleProduced(msg: SfuProducedMessage): void {
    const resolve = this.pendingProduce.get(msg.kind);
    if (resolve) {
      resolve(msg.producerId);
      this.pendingProduce.delete(msg.kind);
    }
  }

  handleProducersList(msg: SfuProducersListMessage): void {
    this.pendingProducersList?.(msg.producers);
    this.pendingProducersList = null;
  }

  handleConsumed(msg: SfuConsumedMessage): void {
    const resolve = this.pendingConsume.get(msg.producerId);
    if (resolve) {
      resolve(msg);
      this.pendingConsume.delete(msg.producerId);
    }
  }

  async handleNewProducer(msg: SfuNewProducerMessage): Promise<void> {
    if (!this.recvTransport) return;
    await this._consumeProducer(msg.producerId, msg.peerId, msg.kind);
  }

  handleProducerClosed(msg: SfuProducerClosedMessage): void {
    // Remove video tile for this peer if no more producers
    const remaining = Array.from(this.consumers.values()).filter(
      (c) => c.appData?.peerId === msg.peerId && !c.closed
    );
    if (remaining.length === 0) {
      this._removePeerStreams(msg.peerId);
    }
  }

  // ── Join SFU bubble ───────────────────────────────────────────────────────────

  async join(): Promise<void> {
    // 1. Load mediasoup-client Device
    const { Device: DeviceClass } = await import("mediasoup-client");
    this.device = new DeviceClass();

    // 2. Get router RTP capabilities
    const caps = await this._requestCaps();
    await this.device.load({ routerRtpCapabilities: caps as never });

    // 3. Create send transport and produce
    await this._setupSendTransport();

    // 4. Create recv transport and consume all existing producers
    await this._setupRecvTransport();
    await this._consumeAllExisting();
  }

  // ── Leave SFU bubble ──────────────────────────────────────────────────────────

  leave(): void {
    this.send({ type: "sfu.leave" });

    this.audioProducer?.close();
    this.videoProducer?.close();
    this.audioProducer = null;
    this.videoProducer = null;

    for (const consumer of this.consumers.values()) consumer.close();
    this.consumers.clear();

    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;

    for (const [peerId] of this.peerStreams) this._removePeerStreams(peerId);
    this.peerStreams.clear();

    for (const gn of this.gainNodes.values()) gn.disconnect();
    this.gainNodes.clear();

    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.device = null;
  }

  updateSpatialGain(peerId: string, distancePx: number): void {
    const gainNode = this.gainNodes.get(peerId);
    if (!gainNode || !this.audioCtx) return;
    const BUBBLE_R = 160;
    const EXIT_R = 200;
    const gain = Math.max(0, Math.min(1, 1 - (distancePx - BUBBLE_R) / (EXIT_R - BUBBLE_R)));
    gainNode.gain.setTargetAtTime(gain, this.audioCtx.currentTime, 0.05);
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private _requestCaps(): Promise<unknown> {
    return new Promise((resolve) => {
      this.pendingCaps = resolve;
      this.send({ type: "sfu.get-caps" });
    });
  }

  private _requestTransport(direction: "send" | "recv"): Promise<SfuTransportCreatedMessage> {
    return new Promise((resolve) => {
      if (direction === "send") this.pendingSendTransport = resolve;
      else this.pendingRecvTransport = resolve;
      this.send({ type: "sfu.create-transport", direction });
    });
  }

  private async _setupSendTransport(): Promise<void> {
    if (!this.device || !this.localStream) return;

    const info = await this._requestTransport("send");
    const transport = this.device.createSendTransport({
      id: info.id,
      iceParameters: info.iceParameters as never,
      iceCandidates: info.iceCandidates as never,
      dtlsParameters: info.dtlsParameters as never,
    });

    (transport as unknown as { on(ev: string, fn: AnyFn): void }).on("connect", ({ dtlsParameters }: { dtlsParameters: unknown }, callback: AnyFn, errback: AnyFn) => {
      try {
        this.send({ type: "sfu.connect-transport", transportId: transport.id, direction: "send", dtlsParameters });
        callback();
      } catch (e) { errback(e as Error); }
    });

    (transport as unknown as { on(ev: string, fn: AnyFn): void }).on("produce", ({ kind, rtpParameters }: { kind: string; rtpParameters: unknown }, callback: AnyFn, errback: AnyFn) => {
      try {
        const k = kind as "audio" | "video";
        this.pendingProduce.set(k, (producerId) => callback({ id: producerId }));
        this.send({ type: "sfu.produce", transportId: transport.id, kind: k, rtpParameters });
      } catch (e) { errback(e as Error); }
    });

    this.sendTransport = transport;

    const audioTrack = this.localStream.getAudioTracks()[0];
    const videoTrack = this.localStream.getVideoTracks()[0];

    if (audioTrack) this.audioProducer = await transport.produce({ track: audioTrack });
    if (videoTrack) this.videoProducer = await transport.produce({ track: videoTrack, encodings: [{ maxBitrate: 300_000 }] });
  }

  private async _setupRecvTransport(): Promise<void> {
    if (!this.device) return;

    const info = await this._requestTransport("recv");
    const transport = this.device.createRecvTransport({
      id: info.id,
      iceParameters: info.iceParameters as never,
      iceCandidates: info.iceCandidates as never,
      dtlsParameters: info.dtlsParameters as never,
    });

    (transport as unknown as { on(ev: string, fn: AnyFn): void }).on("connect", ({ dtlsParameters }: { dtlsParameters: unknown }, callback: AnyFn, errback: AnyFn) => {
      try {
        this.send({ type: "sfu.connect-transport", transportId: transport.id, direction: "recv", dtlsParameters });
        callback();
      } catch (e) { errback(e as Error); }
    });

    this.recvTransport = transport;
  }

  private _requestProducersList(): Promise<SfuProducersListMessage["producers"]> {
    return new Promise((resolve) => {
      this.pendingProducersList = resolve;
      this.send({ type: "sfu.get-producers" });
    });
  }

  private async _consumeAllExisting(): Promise<void> {
    const producers = await this._requestProducersList();
    for (const { producerId, peerId, kind } of producers) {
      await this._consumeProducer(producerId, peerId, kind);
    }
  }

  private async _consumeProducer(producerId: string, peerId: string, kind: string): Promise<void> {
    if (!this.recvTransport || !this.device) return;

    const info = await new Promise<SfuConsumedMessage>((resolve) => {
      this.pendingConsume.set(producerId, resolve);
      this.send({
        type: "sfu.consume",
        transportId: this.recvTransport!.id,
        producerId,
        rtpCapabilities: this.device!.rtpCapabilities,
      });
    });

    const consumer = await this.recvTransport.consume({
      id: info.consumerId,
      producerId: info.producerId,
      kind: info.kind as "audio" | "video",
      rtpParameters: info.rtpParameters as never,
      appData: { peerId },
    });

    this.consumers.set(consumer.id, consumer);

    this.send({ type: "sfu.resume-consumer", consumerId: consumer.id });
    consumer.resume();

    if (!this.peerStreams.has(peerId)) {
      this.peerStreams.set(peerId, { audioEl: null, videoEl: null });
    }
    const streams = this.peerStreams.get(peerId)!;

    if (kind === "audio") {
      const ctx = this._getAudioCtx();
      const source = ctx.createMediaStreamSource(new MediaStream([consumer.track]));
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      this.gainNodes.set(peerId, gainNode);

      const el = new Audio();
      el.srcObject = new MediaStream([consumer.track]);
      el.play().catch(() => {});
      streams.audioEl = el;
    } else if (kind === "video") {
      const el = document.createElement("video");
      el.autoplay = true;
      el.playsInline = true;
      el.muted = true;
      el.srcObject = new MediaStream([consumer.track]);
      streams.videoEl = el;
      this.onVideoChange(peerId, el);
    }
  }

  private _removePeerStreams(peerId: string): void {
    const streams = this.peerStreams.get(peerId);
    if (!streams) return;

    streams.audioEl?.pause();
    this.gainNodes.get(peerId)?.disconnect();
    this.gainNodes.delete(peerId);

    if (streams.videoEl) {
      this.onVideoChange(peerId, null);
      streams.videoEl.srcObject = null;
    }

    this.peerStreams.delete(peerId);
  }

  private _getAudioCtx(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }
}
