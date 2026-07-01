import { z } from "zod";
export declare const FacingSchema: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
export type Facing = z.infer<typeof FacingSchema>;
export declare const RemotePlayerSchema: z.ZodObject<{
    id: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    name: z.ZodString;
    spriteKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
}, {
    id: string;
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
}>;
export type RemotePlayer = z.infer<typeof RemotePlayerSchema>;
export declare const WORLD_W = 1152;
export declare const WORLD_H = 864;
export declare const SPAWN_X = 192;
export declare const SPAWN_Y = 144;
export declare const PlayerMoveSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.move">;
    dx: z.ZodNumber;
    dy: z.ZodNumber;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}>;
export type PlayerMove = z.infer<typeof PlayerMoveSchema>;
export declare const PingSchema: z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    clientTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ping";
    clientTime: number;
}, {
    type: "ping";
    clientTime: number;
}>;
export type Ping = z.infer<typeof PingSchema>;
export declare const WorldSnapshotSchema: z.ZodObject<{
    type: z.ZodLiteral<"world.snapshot">;
    players: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export declare const WelcomeSchema: z.ZodObject<{
    type: z.ZodLiteral<"welcome">;
    playerId: z.ZodString;
    worldSnapshot: z.ZodObject<{
        type: z.ZodLiteral<"world.snapshot">;
        players: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
            name: z.ZodString;
            spriteKey: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}>;
export type Welcome = z.infer<typeof WelcomeSchema>;
export declare const PlayerJoinedSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.joined">;
    player: z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}>;
export type PlayerJoined = z.infer<typeof PlayerJoinedSchema>;
export declare const PlayerLeftSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.left">;
    playerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "player.left";
    playerId: string;
}, {
    type: "player.left";
    playerId: string;
}>;
export type PlayerLeft = z.infer<typeof PlayerLeftSchema>;
export declare const PlayerStateSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.state">;
    playerId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}>;
export type PlayerState = z.infer<typeof PlayerStateSchema>;
export declare const PongSchema: z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    clientTime: z.ZodNumber;
    serverTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}>;
export type Pong = z.infer<typeof PongSchema>;
export declare const BubbleJoinSchema: z.ZodObject<{
    type: z.ZodLiteral<"bubble.join">;
    bubbleId: z.ZodString;
    members: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    type: "bubble.join";
    bubbleId: string;
    members: string[];
}, {
    type: "bubble.join";
    bubbleId: string;
    members: string[];
}>;
export type BubbleJoin = z.infer<typeof BubbleJoinSchema>;
export declare const BubbleLeaveSchema: z.ZodObject<{
    type: z.ZodLiteral<"bubble.leave">;
    bubbleId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "bubble.leave";
    bubbleId: string;
}, {
    type: "bubble.leave";
    bubbleId: string;
}>;
export type BubbleLeave = z.infer<typeof BubbleLeaveSchema>;
export declare const BubbleUpdateSchema: z.ZodObject<{
    type: z.ZodLiteral<"bubble.update">;
    bubbleId: z.ZodString;
    members: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    type: "bubble.update";
    bubbleId: string;
    members: string[];
}, {
    type: "bubble.update";
    bubbleId: string;
    members: string[];
}>;
export type BubbleUpdate = z.infer<typeof BubbleUpdateSchema>;
export declare const RtcOfferClientSchema: z.ZodObject<{
    type: z.ZodLiteral<"rtc.offer">;
    to: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.offer";
    to: string;
    sdp: string;
}, {
    type: "rtc.offer";
    to: string;
    sdp: string;
}>;
export type RtcOfferClient = z.infer<typeof RtcOfferClientSchema>;
export declare const RtcAnswerClientSchema: z.ZodObject<{
    type: z.ZodLiteral<"rtc.answer">;
    to: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.answer";
    to: string;
    sdp: string;
}, {
    type: "rtc.answer";
    to: string;
    sdp: string;
}>;
export type RtcAnswerClient = z.infer<typeof RtcAnswerClientSchema>;
export declare const RtcIceClientSchema: z.ZodObject<{
    type: z.ZodLiteral<"rtc.ice">;
    to: z.ZodString;
    candidate: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "rtc.ice";
    to: string;
    candidate?: unknown;
}, {
    type: "rtc.ice";
    to: string;
    candidate?: unknown;
}>;
export type RtcIceClient = z.infer<typeof RtcIceClientSchema>;
export declare const RtcLeaveClientSchema: z.ZodObject<{
    type: z.ZodLiteral<"rtc.leave">;
}, "strip", z.ZodTypeAny, {
    type: "rtc.leave";
}, {
    type: "rtc.leave";
}>;
export type RtcLeaveClient = z.infer<typeof RtcLeaveClientSchema>;
export declare const RtcOfferServerSchema: z.ZodObject<{
    type: z.ZodLiteral<"rtc.offer">;
    from: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.offer";
    sdp: string;
    from: string;
}, {
    type: "rtc.offer";
    sdp: string;
    from: string;
}>;
export type RtcOfferServer = z.infer<typeof RtcOfferServerSchema>;
export declare const RtcAnswerServerSchema: z.ZodObject<{
    type: z.ZodLiteral<"rtc.answer">;
    from: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.answer";
    sdp: string;
    from: string;
}, {
    type: "rtc.answer";
    sdp: string;
    from: string;
}>;
export type RtcAnswerServer = z.infer<typeof RtcAnswerServerSchema>;
export declare const RtcIceServerSchema: z.ZodObject<{
    type: z.ZodLiteral<"rtc.ice">;
    from: z.ZodString;
    candidate: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "rtc.ice";
    from: string;
    candidate?: unknown;
}, {
    type: "rtc.ice";
    from: string;
    candidate?: unknown;
}>;
export type RtcIceServer = z.infer<typeof RtcIceServerSchema>;
export declare const SfuGetCapsSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.get-caps">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.get-caps";
}, {
    type: "sfu.get-caps";
}>;
export declare const SfuCreateTransportSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.create-transport">;
    direction: z.ZodEnum<["send", "recv"]>;
}, "strip", z.ZodTypeAny, {
    type: "sfu.create-transport";
    direction: "send" | "recv";
}, {
    type: "sfu.create-transport";
    direction: "send" | "recv";
}>;
export declare const SfuConnectTransportSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.connect-transport">;
    transportId: z.ZodString;
    direction: z.ZodEnum<["send", "recv"]>;
    dtlsParameters: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.connect-transport";
    direction: "send" | "recv";
    transportId: string;
    dtlsParameters?: unknown;
}, {
    type: "sfu.connect-transport";
    direction: "send" | "recv";
    transportId: string;
    dtlsParameters?: unknown;
}>;
export declare const SfuProduceSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.produce">;
    transportId: z.ZodString;
    kind: z.ZodEnum<["audio", "video"]>;
    rtpParameters: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.produce";
    transportId: string;
    kind: "audio" | "video";
    rtpParameters?: unknown;
}, {
    type: "sfu.produce";
    transportId: string;
    kind: "audio" | "video";
    rtpParameters?: unknown;
}>;
export declare const SfuGetProducersSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.get-producers">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.get-producers";
}, {
    type: "sfu.get-producers";
}>;
export declare const SfuConsumeSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.consume">;
    transportId: z.ZodString;
    producerId: z.ZodString;
    rtpCapabilities: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.consume";
    transportId: string;
    producerId: string;
    rtpCapabilities?: unknown;
}, {
    type: "sfu.consume";
    transportId: string;
    producerId: string;
    rtpCapabilities?: unknown;
}>;
export declare const SfuResumeConsumerSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.resume-consumer">;
    consumerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.resume-consumer";
    consumerId: string;
}, {
    type: "sfu.resume-consumer";
    consumerId: string;
}>;
export declare const SfuLeaveSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.leave">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.leave";
}, {
    type: "sfu.leave";
}>;
export declare const SfuRouterCapsSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.router-caps">;
    rtpCapabilities: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.router-caps";
    rtpCapabilities?: unknown;
}, {
    type: "sfu.router-caps";
    rtpCapabilities?: unknown;
}>;
export declare const SfuTransportCreatedSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.transport-created">;
    direction: z.ZodEnum<["send", "recv"]>;
    id: z.ZodString;
    iceParameters: z.ZodUnknown;
    iceCandidates: z.ZodUnknown;
    dtlsParameters: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.transport-created";
    id: string;
    direction: "send" | "recv";
    dtlsParameters?: unknown;
    iceParameters?: unknown;
    iceCandidates?: unknown;
}, {
    type: "sfu.transport-created";
    id: string;
    direction: "send" | "recv";
    dtlsParameters?: unknown;
    iceParameters?: unknown;
    iceCandidates?: unknown;
}>;
export declare const SfuProducedSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.produced">;
    producerId: z.ZodString;
    kind: z.ZodEnum<["audio", "video"]>;
}, "strip", z.ZodTypeAny, {
    type: "sfu.produced";
    kind: "audio" | "video";
    producerId: string;
}, {
    type: "sfu.produced";
    kind: "audio" | "video";
    producerId: string;
}>;
export declare const SfuProducersListSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.producers-list">;
    producers: z.ZodArray<z.ZodObject<{
        producerId: z.ZodString;
        peerId: z.ZodString;
        kind: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        producerId: string;
        peerId: string;
    }, {
        kind: string;
        producerId: string;
        peerId: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.producers-list";
    producers: {
        kind: string;
        producerId: string;
        peerId: string;
    }[];
}, {
    type: "sfu.producers-list";
    producers: {
        kind: string;
        producerId: string;
        peerId: string;
    }[];
}>;
export declare const SfuConsumedSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.consumed">;
    consumerId: z.ZodString;
    producerId: z.ZodString;
    kind: z.ZodString;
    rtpParameters: z.ZodUnknown;
    paused: z.ZodBoolean;
    peerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.consumed";
    kind: string;
    producerId: string;
    consumerId: string;
    peerId: string;
    paused: boolean;
    rtpParameters?: unknown;
}, {
    type: "sfu.consumed";
    kind: string;
    producerId: string;
    consumerId: string;
    peerId: string;
    paused: boolean;
    rtpParameters?: unknown;
}>;
export declare const SfuNewProducerSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.new-producer">;
    peerId: z.ZodString;
    producerId: z.ZodString;
    kind: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.new-producer";
    kind: string;
    producerId: string;
    peerId: string;
}, {
    type: "sfu.new-producer";
    kind: string;
    producerId: string;
    peerId: string;
}>;
export declare const SfuProducerClosedSchema: z.ZodObject<{
    type: z.ZodLiteral<"sfu.producer-closed">;
    producerId: z.ZodString;
    peerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.producer-closed";
    producerId: string;
    peerId: string;
}, {
    type: "sfu.producer-closed";
    producerId: string;
    peerId: string;
}>;
export declare const BubbleSfuSwitchSchema: z.ZodObject<{
    type: z.ZodLiteral<"bubble.sfu-switch">;
    bubbleId: z.ZodString;
    members: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    type: "bubble.sfu-switch";
    bubbleId: string;
    members: string[];
}, {
    type: "bubble.sfu-switch";
    bubbleId: string;
    members: string[];
}>;
export declare const NpcDataSchema: z.ZodObject<{
    npcId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    spriteKey: z.ZodString;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
    npcId: string;
}, {
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
    npcId: string;
}>;
export type NpcData = z.infer<typeof NpcDataSchema>;
export declare const NpcStateSchema: z.ZodObject<{
    npcId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    spriteKey: z.ZodString;
    name: z.ZodString;
} & {
    type: z.ZodLiteral<"npc.state">;
}, "strip", z.ZodTypeAny, {
    type: "npc.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
    npcId: string;
}, {
    type: "npc.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
    npcId: string;
}>;
export type NpcState = z.infer<typeof NpcStateSchema>;
export declare const NpcSnapshotSchema: z.ZodObject<{
    type: z.ZodLiteral<"npc.snapshot">;
    npcs: z.ZodArray<z.ZodObject<{
        npcId: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        spriteKey: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }, {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "npc.snapshot";
    npcs: {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }[];
}, {
    type: "npc.snapshot";
    npcs: {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }[];
}>;
export type NpcSnapshot = z.infer<typeof NpcSnapshotSchema>;
export declare const ClientMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"player.move">;
    dx: z.ZodNumber;
    dy: z.ZodNumber;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    clientTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ping";
    clientTime: number;
}, {
    type: "ping";
    clientTime: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"rtc.offer">;
    to: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.offer";
    to: string;
    sdp: string;
}, {
    type: "rtc.offer";
    to: string;
    sdp: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"rtc.answer">;
    to: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.answer";
    to: string;
    sdp: string;
}, {
    type: "rtc.answer";
    to: string;
    sdp: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"rtc.ice">;
    to: z.ZodString;
    candidate: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "rtc.ice";
    to: string;
    candidate?: unknown;
}, {
    type: "rtc.ice";
    to: string;
    candidate?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"rtc.leave">;
}, "strip", z.ZodTypeAny, {
    type: "rtc.leave";
}, {
    type: "rtc.leave";
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.get-caps">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.get-caps";
}, {
    type: "sfu.get-caps";
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.create-transport">;
    direction: z.ZodEnum<["send", "recv"]>;
}, "strip", z.ZodTypeAny, {
    type: "sfu.create-transport";
    direction: "send" | "recv";
}, {
    type: "sfu.create-transport";
    direction: "send" | "recv";
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.connect-transport">;
    transportId: z.ZodString;
    direction: z.ZodEnum<["send", "recv"]>;
    dtlsParameters: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.connect-transport";
    direction: "send" | "recv";
    transportId: string;
    dtlsParameters?: unknown;
}, {
    type: "sfu.connect-transport";
    direction: "send" | "recv";
    transportId: string;
    dtlsParameters?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.produce">;
    transportId: z.ZodString;
    kind: z.ZodEnum<["audio", "video"]>;
    rtpParameters: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.produce";
    transportId: string;
    kind: "audio" | "video";
    rtpParameters?: unknown;
}, {
    type: "sfu.produce";
    transportId: string;
    kind: "audio" | "video";
    rtpParameters?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.get-producers">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.get-producers";
}, {
    type: "sfu.get-producers";
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.consume">;
    transportId: z.ZodString;
    producerId: z.ZodString;
    rtpCapabilities: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.consume";
    transportId: string;
    producerId: string;
    rtpCapabilities?: unknown;
}, {
    type: "sfu.consume";
    transportId: string;
    producerId: string;
    rtpCapabilities?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.resume-consumer">;
    consumerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.resume-consumer";
    consumerId: string;
}, {
    type: "sfu.resume-consumer";
    consumerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.leave">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.leave";
}, {
    type: "sfu.leave";
}>]>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export declare const ServerMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"welcome">;
    playerId: z.ZodString;
    worldSnapshot: z.ZodObject<{
        type: z.ZodLiteral<"world.snapshot">;
        players: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
            name: z.ZodString;
            spriteKey: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"player.joined">;
    player: z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"player.left">;
    playerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "player.left";
    playerId: string;
}, {
    type: "player.left";
    playerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"player.state">;
    playerId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"world.snapshot">;
    players: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    clientTime: z.ZodNumber;
    serverTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"bubble.join">;
    bubbleId: z.ZodString;
    members: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    type: "bubble.join";
    bubbleId: string;
    members: string[];
}, {
    type: "bubble.join";
    bubbleId: string;
    members: string[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"bubble.leave">;
    bubbleId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "bubble.leave";
    bubbleId: string;
}, {
    type: "bubble.leave";
    bubbleId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"bubble.update">;
    bubbleId: z.ZodString;
    members: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    type: "bubble.update";
    bubbleId: string;
    members: string[];
}, {
    type: "bubble.update";
    bubbleId: string;
    members: string[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"rtc.offer">;
    from: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.offer";
    sdp: string;
    from: string;
}, {
    type: "rtc.offer";
    sdp: string;
    from: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"rtc.answer">;
    from: z.ZodString;
    sdp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "rtc.answer";
    sdp: string;
    from: string;
}, {
    type: "rtc.answer";
    sdp: string;
    from: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"rtc.ice">;
    from: z.ZodString;
    candidate: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "rtc.ice";
    from: string;
    candidate?: unknown;
}, {
    type: "rtc.ice";
    from: string;
    candidate?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.router-caps">;
    rtpCapabilities: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.router-caps";
    rtpCapabilities?: unknown;
}, {
    type: "sfu.router-caps";
    rtpCapabilities?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.transport-created">;
    direction: z.ZodEnum<["send", "recv"]>;
    id: z.ZodString;
    iceParameters: z.ZodUnknown;
    iceCandidates: z.ZodUnknown;
    dtlsParameters: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: "sfu.transport-created";
    id: string;
    direction: "send" | "recv";
    dtlsParameters?: unknown;
    iceParameters?: unknown;
    iceCandidates?: unknown;
}, {
    type: "sfu.transport-created";
    id: string;
    direction: "send" | "recv";
    dtlsParameters?: unknown;
    iceParameters?: unknown;
    iceCandidates?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.produced">;
    producerId: z.ZodString;
    kind: z.ZodEnum<["audio", "video"]>;
}, "strip", z.ZodTypeAny, {
    type: "sfu.produced";
    kind: "audio" | "video";
    producerId: string;
}, {
    type: "sfu.produced";
    kind: "audio" | "video";
    producerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.producers-list">;
    producers: z.ZodArray<z.ZodObject<{
        producerId: z.ZodString;
        peerId: z.ZodString;
        kind: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        producerId: string;
        peerId: string;
    }, {
        kind: string;
        producerId: string;
        peerId: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "sfu.producers-list";
    producers: {
        kind: string;
        producerId: string;
        peerId: string;
    }[];
}, {
    type: "sfu.producers-list";
    producers: {
        kind: string;
        producerId: string;
        peerId: string;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.consumed">;
    consumerId: z.ZodString;
    producerId: z.ZodString;
    kind: z.ZodString;
    rtpParameters: z.ZodUnknown;
    paused: z.ZodBoolean;
    peerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.consumed";
    kind: string;
    producerId: string;
    consumerId: string;
    peerId: string;
    paused: boolean;
    rtpParameters?: unknown;
}, {
    type: "sfu.consumed";
    kind: string;
    producerId: string;
    consumerId: string;
    peerId: string;
    paused: boolean;
    rtpParameters?: unknown;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.new-producer">;
    peerId: z.ZodString;
    producerId: z.ZodString;
    kind: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.new-producer";
    kind: string;
    producerId: string;
    peerId: string;
}, {
    type: "sfu.new-producer";
    kind: string;
    producerId: string;
    peerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"sfu.producer-closed">;
    producerId: z.ZodString;
    peerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "sfu.producer-closed";
    producerId: string;
    peerId: string;
}, {
    type: "sfu.producer-closed";
    producerId: string;
    peerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"bubble.sfu-switch">;
    bubbleId: z.ZodString;
    members: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    type: "bubble.sfu-switch";
    bubbleId: string;
    members: string[];
}, {
    type: "bubble.sfu-switch";
    bubbleId: string;
    members: string[];
}>, z.ZodObject<{
    npcId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    spriteKey: z.ZodString;
    name: z.ZodString;
} & {
    type: z.ZodLiteral<"npc.state">;
}, "strip", z.ZodTypeAny, {
    type: "npc.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
    npcId: string;
}, {
    type: "npc.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
    npcId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"npc.snapshot">;
    npcs: z.ZodArray<z.ZodObject<{
        npcId: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        spriteKey: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }, {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "npc.snapshot";
    npcs: {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }[];
}, {
    type: "npc.snapshot";
    npcs: {
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
        npcId: string;
    }[];
}>]>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
//# sourceMappingURL=messages.d.ts.map