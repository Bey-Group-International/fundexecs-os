import * as mediasoup from "mediasoup";

// RouterRtpCodecCapability omits the required `preferredPayloadType` field
const MEDIA_CODECS: mediasoup.types.RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
  },
];

export interface TransportInfo {
  id: string;
  direction: "send" | "recv";
  iceParameters: mediasoup.types.IceParameters;
  iceCandidates: mediasoup.types.IceCandidate[];
  dtlsParameters: mediasoup.types.DtlsParameters;
}

export interface ProducerInfo {
  producerId: string;
  peerId: string;
  kind: string;
}

export interface ConsumerInfo {
  consumerId: string;
  producerId: string;
  kind: string;
  rtpParameters: mediasoup.types.RtpParameters;
  paused: boolean;
  peerId: string;
}

export class SfuRoom {
  private router: mediasoup.types.Router | null = null;
  private transports = new Map<string, mediasoup.types.WebRtcTransport>();
  private producers = new Map<string, { producer: mediasoup.types.Producer; peerId: string }>();
  private consumers = new Map<string, mediasoup.types.Consumer>();
  private peerTransports = new Map<string, { send?: string; recv?: string }>();
  private peerProducers = new Map<string, Set<string>>();

  constructor(private readonly worker: mediasoup.types.Worker) {}

  private async getRouter(): Promise<mediasoup.types.Router> {
    if (!this.router) {
      this.router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
    }
    return this.router;
  }

  async getRouterCapabilities(): Promise<mediasoup.types.RtpCapabilities> {
    return (await this.getRouter()).rtpCapabilities;
  }

  async createTransport(peerId: string, direction: "send" | "recv"): Promise<TransportInfo> {
    const router = await this.getRouter();
    const announcedAddress = process.env.ANNOUNCED_IP ?? "127.0.0.1";

    const transport = await router.createWebRtcTransport({
      listenInfos: [
        { protocol: "udp", ip: "0.0.0.0", announcedAddress },
        { protocol: "tcp", ip: "0.0.0.0", announcedAddress },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    this.transports.set(transport.id, transport);
    if (!this.peerTransports.has(peerId)) this.peerTransports.set(peerId, {});
    this.peerTransports.get(peerId)![direction] = transport.id;

    return {
      id: transport.id,
      direction,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(transportId: string, dtlsParameters: unknown): Promise<void> {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);
    await transport.connect({ dtlsParameters: dtlsParameters as mediasoup.types.DtlsParameters });
  }

  async produce(
    peerId: string,
    transportId: string,
    kind: "audio" | "video",
    rtpParameters: unknown
  ): Promise<{ producerId: string }> {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = await transport.produce({
      kind,
      rtpParameters: rtpParameters as mediasoup.types.RtpParameters,
    });

    this.producers.set(producer.id, { producer, peerId });
    if (!this.peerProducers.has(peerId)) this.peerProducers.set(peerId, new Set());
    this.peerProducers.get(peerId)!.add(producer.id);

    return { producerId: producer.id };
  }

  getAllProducers(): ProducerInfo[] {
    return Array.from(this.producers.entries()).map(([producerId, { producer, peerId }]) => ({
      producerId,
      peerId,
      kind: producer.kind,
    }));
  }

  async consume(
    peerId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: unknown
  ): Promise<ConsumerInfo | null> {
    const router = await this.getRouter();
    const transport = this.transports.get(transportId);
    if (!transport) return null;

    const producerEntry = this.producers.get(producerId);
    if (!producerEntry) return null;

    const caps = rtpCapabilities as mediasoup.types.RtpCapabilities;
    if (!router.canConsume({ producerId, rtpCapabilities: caps })) return null;

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: caps,
      paused: true,
    });

    this.consumers.set(consumer.id, consumer);

    return {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      paused: true,
      peerId: producerEntry.peerId,
    };
  }

  async resumeConsumer(consumerId: string): Promise<void> {
    const consumer = this.consumers.get(consumerId);
    if (consumer) await consumer.resume();
  }

  removePeer(peerId: string): string[] {
    const closedProducerIds: string[] = [];

    const peerProds = this.peerProducers.get(peerId);
    if (peerProds) {
      for (const pid of peerProds) {
        const entry = this.producers.get(pid);
        if (entry) {
          entry.producer.close();
          this.producers.delete(pid);
          closedProducerIds.push(pid);
        }
      }
      this.peerProducers.delete(peerId);
    }

    const peerTrans = this.peerTransports.get(peerId);
    if (peerTrans) {
      if (peerTrans.send) {
        this.transports.get(peerTrans.send)?.close();
        this.transports.delete(peerTrans.send);
      }
      if (peerTrans.recv) {
        this.transports.get(peerTrans.recv)?.close();
        this.transports.delete(peerTrans.recv);
      }
      this.peerTransports.delete(peerId);
    }

    return closedProducerIds;
  }

  close(): void {
    this.router?.close();
    this.router = null;
  }

  get peerCount(): number {
    return this.peerTransports.size;
  }
}
