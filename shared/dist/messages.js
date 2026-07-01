"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerMessageSchema = exports.ClientMessageSchema = exports.NpcSnapshotSchema = exports.NpcStateSchema = exports.NpcDataSchema = exports.BubbleSfuSwitchSchema = exports.SfuProducerClosedSchema = exports.SfuNewProducerSchema = exports.SfuConsumedSchema = exports.SfuProducersListSchema = exports.SfuProducedSchema = exports.SfuTransportCreatedSchema = exports.SfuRouterCapsSchema = exports.SfuLeaveSchema = exports.SfuResumeConsumerSchema = exports.SfuConsumeSchema = exports.SfuGetProducersSchema = exports.SfuProduceSchema = exports.SfuConnectTransportSchema = exports.SfuCreateTransportSchema = exports.SfuGetCapsSchema = exports.RtcIceServerSchema = exports.RtcAnswerServerSchema = exports.RtcOfferServerSchema = exports.RtcLeaveClientSchema = exports.RtcIceClientSchema = exports.RtcAnswerClientSchema = exports.RtcOfferClientSchema = exports.BubbleUpdateSchema = exports.BubbleLeaveSchema = exports.BubbleJoinSchema = exports.PongSchema = exports.PlayerStateSchema = exports.PlayerLeftSchema = exports.PlayerJoinedSchema = exports.WelcomeSchema = exports.WorldSnapshotSchema = exports.PingSchema = exports.PlayerMoveSchema = exports.SPAWN_Y = exports.SPAWN_X = exports.WORLD_H = exports.WORLD_W = exports.RemotePlayerSchema = exports.FacingSchema = void 0;
const zod_1 = require("zod");
// Supporting types
exports.FacingSchema = zod_1.z.enum(["down", "up", "left", "right", "idle"]);
exports.RemotePlayerSchema = zod_1.z.object({
    id: zod_1.z.string(),
    x: zod_1.z.number(),
    y: zod_1.z.number(),
    facing: exports.FacingSchema,
    name: zod_1.z.string(),
    spriteKey: zod_1.z.string(),
});
// World constants
exports.WORLD_W = 1152;
exports.WORLD_H = 864;
exports.SPAWN_X = 192;
exports.SPAWN_Y = 144;
// Client → Server messages
exports.PlayerMoveSchema = zod_1.z.object({
    type: zod_1.z.literal("player.move"),
    dx: zod_1.z.number(),
    dy: zod_1.z.number(),
    seq: zod_1.z.number(),
});
exports.PingSchema = zod_1.z.object({
    type: zod_1.z.literal("ping"),
    clientTime: zod_1.z.number(),
});
// Extended below with RTC variants after those schemas are defined
// Server → Client messages
exports.WorldSnapshotSchema = zod_1.z.object({
    type: zod_1.z.literal("world.snapshot"),
    players: zod_1.z.array(exports.RemotePlayerSchema),
});
exports.WelcomeSchema = zod_1.z.object({
    type: zod_1.z.literal("welcome"),
    playerId: zod_1.z.string(),
    worldSnapshot: exports.WorldSnapshotSchema,
});
exports.PlayerJoinedSchema = zod_1.z.object({
    type: zod_1.z.literal("player.joined"),
    player: exports.RemotePlayerSchema,
});
exports.PlayerLeftSchema = zod_1.z.object({
    type: zod_1.z.literal("player.left"),
    playerId: zod_1.z.string(),
});
exports.PlayerStateSchema = zod_1.z.object({
    type: zod_1.z.literal("player.state"),
    playerId: zod_1.z.string(),
    x: zod_1.z.number(),
    y: zod_1.z.number(),
    facing: exports.FacingSchema,
    seq: zod_1.z.number(),
});
exports.PongSchema = zod_1.z.object({
    type: zod_1.z.literal("pong"),
    clientTime: zod_1.z.number(),
    serverTime: zod_1.z.number(),
});
exports.BubbleJoinSchema = zod_1.z.object({
    type: zod_1.z.literal("bubble.join"),
    bubbleId: zod_1.z.string(),
    members: zod_1.z.array(zod_1.z.string()),
});
exports.BubbleLeaveSchema = zod_1.z.object({
    type: zod_1.z.literal("bubble.leave"),
    bubbleId: zod_1.z.string(),
});
exports.BubbleUpdateSchema = zod_1.z.object({
    type: zod_1.z.literal("bubble.update"),
    bubbleId: zod_1.z.string(),
    members: zod_1.z.array(zod_1.z.string()),
});
// ─── WebRTC signalling — Client → Server (targeted relay) ────────────────────
exports.RtcOfferClientSchema = zod_1.z.object({
    type: zod_1.z.literal("rtc.offer"),
    to: zod_1.z.string(),
    sdp: zod_1.z.string(),
});
exports.RtcAnswerClientSchema = zod_1.z.object({
    type: zod_1.z.literal("rtc.answer"),
    to: zod_1.z.string(),
    sdp: zod_1.z.string(),
});
exports.RtcIceClientSchema = zod_1.z.object({
    type: zod_1.z.literal("rtc.ice"),
    to: zod_1.z.string(),
    candidate: zod_1.z.unknown(),
});
exports.RtcLeaveClientSchema = zod_1.z.object({
    type: zod_1.z.literal("rtc.leave"),
});
// ─── WebRTC signalling — Server → Client (relayed with `from`) ───────────────
exports.RtcOfferServerSchema = zod_1.z.object({
    type: zod_1.z.literal("rtc.offer"),
    from: zod_1.z.string(),
    sdp: zod_1.z.string(),
});
exports.RtcAnswerServerSchema = zod_1.z.object({
    type: zod_1.z.literal("rtc.answer"),
    from: zod_1.z.string(),
    sdp: zod_1.z.string(),
});
exports.RtcIceServerSchema = zod_1.z.object({
    type: zod_1.z.literal("rtc.ice"),
    from: zod_1.z.string(),
    candidate: zod_1.z.unknown(),
});
// ─── SFU signalling — Client → Server ────────────────────────────────────────
exports.SfuGetCapsSchema = zod_1.z.object({ type: zod_1.z.literal("sfu.get-caps") });
exports.SfuCreateTransportSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.create-transport"),
    direction: zod_1.z.enum(["send", "recv"]),
});
exports.SfuConnectTransportSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.connect-transport"),
    transportId: zod_1.z.string(),
    direction: zod_1.z.enum(["send", "recv"]),
    dtlsParameters: zod_1.z.unknown(),
});
exports.SfuProduceSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.produce"),
    transportId: zod_1.z.string(),
    kind: zod_1.z.enum(["audio", "video"]),
    rtpParameters: zod_1.z.unknown(),
});
exports.SfuGetProducersSchema = zod_1.z.object({ type: zod_1.z.literal("sfu.get-producers") });
exports.SfuConsumeSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.consume"),
    transportId: zod_1.z.string(),
    producerId: zod_1.z.string(),
    rtpCapabilities: zod_1.z.unknown(),
});
exports.SfuResumeConsumerSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.resume-consumer"),
    consumerId: zod_1.z.string(),
});
exports.SfuLeaveSchema = zod_1.z.object({ type: zod_1.z.literal("sfu.leave") });
// ─── SFU signalling — Server → Client ────────────────────────────────────────
exports.SfuRouterCapsSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.router-caps"),
    rtpCapabilities: zod_1.z.unknown(),
});
exports.SfuTransportCreatedSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.transport-created"),
    direction: zod_1.z.enum(["send", "recv"]),
    id: zod_1.z.string(),
    iceParameters: zod_1.z.unknown(),
    iceCandidates: zod_1.z.unknown(),
    dtlsParameters: zod_1.z.unknown(),
});
exports.SfuProducedSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.produced"),
    producerId: zod_1.z.string(),
    kind: zod_1.z.enum(["audio", "video"]),
});
exports.SfuProducersListSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.producers-list"),
    producers: zod_1.z.array(zod_1.z.object({ producerId: zod_1.z.string(), peerId: zod_1.z.string(), kind: zod_1.z.string() })),
});
exports.SfuConsumedSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.consumed"),
    consumerId: zod_1.z.string(),
    producerId: zod_1.z.string(),
    kind: zod_1.z.string(),
    rtpParameters: zod_1.z.unknown(),
    paused: zod_1.z.boolean(),
    peerId: zod_1.z.string(),
});
exports.SfuNewProducerSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.new-producer"),
    peerId: zod_1.z.string(),
    producerId: zod_1.z.string(),
    kind: zod_1.z.string(),
});
exports.SfuProducerClosedSchema = zod_1.z.object({
    type: zod_1.z.literal("sfu.producer-closed"),
    producerId: zod_1.z.string(),
    peerId: zod_1.z.string(),
});
exports.BubbleSfuSwitchSchema = zod_1.z.object({
    type: zod_1.z.literal("bubble.sfu-switch"),
    bubbleId: zod_1.z.string(),
    members: zod_1.z.array(zod_1.z.string()),
});
// ─── NPC messages — Server → Client ──────────────────────────────────────────
exports.NpcDataSchema = zod_1.z.object({
    npcId: zod_1.z.string(),
    x: zod_1.z.number(),
    y: zod_1.z.number(),
    facing: exports.FacingSchema,
    spriteKey: zod_1.z.string(),
    name: zod_1.z.string(),
});
exports.NpcStateSchema = exports.NpcDataSchema.extend({ type: zod_1.z.literal("npc.state") });
exports.NpcSnapshotSchema = zod_1.z.object({
    type: zod_1.z.literal("npc.snapshot"),
    npcs: zod_1.z.array(exports.NpcDataSchema),
});
exports.ClientMessageSchema = zod_1.z.discriminatedUnion("type", [
    exports.PlayerMoveSchema,
    exports.PingSchema,
    exports.RtcOfferClientSchema,
    exports.RtcAnswerClientSchema,
    exports.RtcIceClientSchema,
    exports.RtcLeaveClientSchema,
    exports.SfuGetCapsSchema,
    exports.SfuCreateTransportSchema,
    exports.SfuConnectTransportSchema,
    exports.SfuProduceSchema,
    exports.SfuGetProducersSchema,
    exports.SfuConsumeSchema,
    exports.SfuResumeConsumerSchema,
    exports.SfuLeaveSchema,
]);
exports.ServerMessageSchema = zod_1.z.discriminatedUnion("type", [
    exports.WelcomeSchema,
    exports.PlayerJoinedSchema,
    exports.PlayerLeftSchema,
    exports.PlayerStateSchema,
    exports.WorldSnapshotSchema,
    exports.PongSchema,
    exports.BubbleJoinSchema,
    exports.BubbleLeaveSchema,
    exports.BubbleUpdateSchema,
    exports.RtcOfferServerSchema,
    exports.RtcAnswerServerSchema,
    exports.RtcIceServerSchema,
    exports.SfuRouterCapsSchema,
    exports.SfuTransportCreatedSchema,
    exports.SfuProducedSchema,
    exports.SfuProducersListSchema,
    exports.SfuConsumedSchema,
    exports.SfuNewProducerSchema,
    exports.SfuProducerClosedSchema,
    exports.BubbleSfuSwitchSchema,
    exports.NpcStateSchema,
    exports.NpcSnapshotSchema,
]);
//# sourceMappingURL=messages.js.map