declare module 'mediasoup-client' {
  export class Device {
    loaded: boolean;
    rtpCapabilities: any;
    load(options: { routerRtpCapabilities: any }): Promise<void>;
    canProduce(kind: string): boolean;
    createSendTransport(options: any): Transport;
    createRecvTransport(options: any): Transport;
  }
  export class Transport {
    id: string;
    on(event: string, handler: (...args: any[]) => void): void;
    produce(options: any): Promise<Producer>;
    consume(options: any): Promise<Consumer>;
    close(): void;
  }
  export class Producer {
    id: string;
    kind: string;
    track: any;
    close(): void;
  }
  export class Consumer {
    id: string;
    kind: string;
    track: any;
    close(): void;
  }
  export const types: any;
}
