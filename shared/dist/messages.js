"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerMessageSchema = exports.ClientMessageSchema = exports.RtcIceServerSchema = exports.RtcAnswerServerSchema = exports.RtcOfferServerSchema = exports.RtcLeaveClientSchema = exports.RtcIceClientSchema = exports.RtcAnswerClientSchema = exports.RtcOfferClientSchema = exports.BubbleUpdateSchema = exports.BubbleLeaveSchema = exports.BubbleJoinSchema = exports.PongSchema = exports.PlayerStateSchema = exports.PlayerLeftSchema = exports.PlayerJoinedSchema = exports.WelcomeSchema = exports.WorldSnapshotSchema = exports.PingSchema = exports.PlayerMoveSchema = exports.SPAWN_Y = exports.SPAWN_X = exports.WORLD_H = exports.WORLD_W = exports.RemotePlayerSchema = exports.FacingSchema = void 0;
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
exports.ClientMessageSchema = zod_1.z.discriminatedUnion("type", [
    exports.PlayerMoveSchema,
    exports.PingSchema,
    exports.RtcOfferClientSchema,
    exports.RtcAnswerClientSchema,
    exports.RtcIceClientSchema,
    exports.RtcLeaveClientSchema,
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
]);
//# sourceMappingURL=messages.js.map