"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SfuRoom = void 0;
// RouterRtpCodecCapability omits the required `preferredPayloadType` field
const MEDIA_CODECS = [
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
class SfuRoom {
    constructor(worker) {
        this.worker = worker;
        this.router = null;
        this.transports = new Map();
        this.producers = new Map();
        this.consumers = new Map();
        this.peerTransports = new Map();
        this.peerProducers = new Map();
    }
    async getRouter() {
        if (!this.router) {
            this.router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
        }
        return this.router;
    }
    async getRouterCapabilities() {
        return (await this.getRouter()).rtpCapabilities;
    }
    async createTransport(peerId, direction) {
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
        if (!this.peerTransports.has(peerId))
            this.peerTransports.set(peerId, {});
        this.peerTransports.get(peerId)[direction] = transport.id;
        return {
            id: transport.id,
            direction,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        };
    }
    async connectTransport(transportId, dtlsParameters) {
        const transport = this.transports.get(transportId);
        if (!transport)
            throw new Error(`Transport ${transportId} not found`);
        await transport.connect({ dtlsParameters: dtlsParameters });
    }
    async produce(peerId, transportId, kind, rtpParameters) {
        const transport = this.transports.get(transportId);
        if (!transport)
            throw new Error(`Transport ${transportId} not found`);
        const producer = await transport.produce({
            kind,
            rtpParameters: rtpParameters,
        });
        this.producers.set(producer.id, { producer, peerId });
        if (!this.peerProducers.has(peerId))
            this.peerProducers.set(peerId, new Set());
        this.peerProducers.get(peerId).add(producer.id);
        return { producerId: producer.id };
    }
    getAllProducers() {
        return Array.from(this.producers.entries()).map(([producerId, { producer, peerId }]) => ({
            producerId,
            peerId,
            kind: producer.kind,
        }));
    }
    async consume(peerId, transportId, producerId, rtpCapabilities) {
        const router = await this.getRouter();
        const transport = this.transports.get(transportId);
        if (!transport)
            return null;
        const producerEntry = this.producers.get(producerId);
        if (!producerEntry)
            return null;
        const caps = rtpCapabilities;
        if (!router.canConsume({ producerId, rtpCapabilities: caps }))
            return null;
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
    async resumeConsumer(consumerId) {
        const consumer = this.consumers.get(consumerId);
        if (consumer)
            await consumer.resume();
    }
    removePeer(peerId) {
        const closedProducerIds = [];
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
    close() {
        this.router?.close();
        this.router = null;
    }
    get peerCount() {
        return this.peerTransports.size;
    }
}
exports.SfuRoom = SfuRoom;
//# sourceMappingURL=SfuRoom.js.map