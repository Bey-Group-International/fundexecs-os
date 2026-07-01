import * as mediasoup from "mediasoup";
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
export declare class SfuRoom {
    private readonly worker;
    private router;
    private transports;
    private producers;
    private consumers;
    private peerTransports;
    private peerProducers;
    constructor(worker: mediasoup.types.Worker);
    private getRouter;
    getRouterCapabilities(): Promise<mediasoup.types.RtpCapabilities>;
    createTransport(peerId: string, direction: "send" | "recv"): Promise<TransportInfo>;
    connectTransport(transportId: string, dtlsParameters: unknown): Promise<void>;
    produce(peerId: string, transportId: string, kind: "audio" | "video", rtpParameters: unknown): Promise<{
        producerId: string;
    }>;
    getAllProducers(): ProducerInfo[];
    consume(peerId: string, transportId: string, producerId: string, rtpCapabilities: unknown): Promise<ConsumerInfo | null>;
    resumeConsumer(consumerId: string): Promise<void>;
    removePeer(peerId: string): string[];
    close(): void;
    get peerCount(): number;
}
