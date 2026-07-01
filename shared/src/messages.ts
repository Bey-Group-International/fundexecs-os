import { z } from "zod";

// Supporting types
export const FacingSchema = z.enum(["down", "up", "left", "right", "idle"]);
export type Facing = z.infer<typeof FacingSchema>;

export const RemotePlayerSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  facing: FacingSchema,
  name: z.string(),
  spriteKey: z.string(),
});
export type RemotePlayer = z.infer<typeof RemotePlayerSchema>;

// World constants
export const WORLD_W = 1152;
export const WORLD_H = 864;
export const SPAWN_X = 192;
export const SPAWN_Y = 144;

// Client → Server messages
export const PlayerMoveSchema = z.object({
  type: z.literal("player.move"),
  dx: z.number(),
  dy: z.number(),
  seq: z.number(),
});
export type PlayerMove = z.infer<typeof PlayerMoveSchema>;

export const PingSchema = z.object({
  type: z.literal("ping"),
  clientTime: z.number(),
});
export type Ping = z.infer<typeof PingSchema>;

// Extended below with RTC variants after those schemas are defined

// Server → Client messages
export const WorldSnapshotSchema = z.object({
  type: z.literal("world.snapshot"),
  players: z.array(RemotePlayerSchema),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

export const WelcomeSchema = z.object({
  type: z.literal("welcome"),
  playerId: z.string(),
  worldSnapshot: WorldSnapshotSchema,
});
export type Welcome = z.infer<typeof WelcomeSchema>;

export const PlayerJoinedSchema = z.object({
  type: z.literal("player.joined"),
  player: RemotePlayerSchema,
});
export type PlayerJoined = z.infer<typeof PlayerJoinedSchema>;

export const PlayerLeftSchema = z.object({
  type: z.literal("player.left"),
  playerId: z.string(),
});
export type PlayerLeft = z.infer<typeof PlayerLeftSchema>;

export const PlayerStateSchema = z.object({
  type: z.literal("player.state"),
  playerId: z.string(),
  x: z.number(),
  y: z.number(),
  facing: FacingSchema,
  seq: z.number(),
});
export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const PongSchema = z.object({
  type: z.literal("pong"),
  clientTime: z.number(),
  serverTime: z.number(),
});
export type Pong = z.infer<typeof PongSchema>;

export const BubbleJoinSchema = z.object({
  type: z.literal("bubble.join"),
  bubbleId: z.string(),
  members: z.array(z.string()),
});
export type BubbleJoin = z.infer<typeof BubbleJoinSchema>;

export const BubbleLeaveSchema = z.object({
  type: z.literal("bubble.leave"),
  bubbleId: z.string(),
});
export type BubbleLeave = z.infer<typeof BubbleLeaveSchema>;

export const BubbleUpdateSchema = z.object({
  type: z.literal("bubble.update"),
  bubbleId: z.string(),
  members: z.array(z.string()),
});
export type BubbleUpdate = z.infer<typeof BubbleUpdateSchema>;

// ─── WebRTC signalling — Client → Server (targeted relay) ────────────────────

export const RtcOfferClientSchema = z.object({
  type: z.literal("rtc.offer"),
  to: z.string(),
  sdp: z.string(),
});
export type RtcOfferClient = z.infer<typeof RtcOfferClientSchema>;

export const RtcAnswerClientSchema = z.object({
  type: z.literal("rtc.answer"),
  to: z.string(),
  sdp: z.string(),
});
export type RtcAnswerClient = z.infer<typeof RtcAnswerClientSchema>;

export const RtcIceClientSchema = z.object({
  type: z.literal("rtc.ice"),
  to: z.string(),
  candidate: z.unknown(),
});
export type RtcIceClient = z.infer<typeof RtcIceClientSchema>;

export const RtcLeaveClientSchema = z.object({
  type: z.literal("rtc.leave"),
});
export type RtcLeaveClient = z.infer<typeof RtcLeaveClientSchema>;

// ─── WebRTC signalling — Server → Client (relayed with `from`) ───────────────

export const RtcOfferServerSchema = z.object({
  type: z.literal("rtc.offer"),
  from: z.string(),
  sdp: z.string(),
});
export type RtcOfferServer = z.infer<typeof RtcOfferServerSchema>;

export const RtcAnswerServerSchema = z.object({
  type: z.literal("rtc.answer"),
  from: z.string(),
  sdp: z.string(),
});
export type RtcAnswerServer = z.infer<typeof RtcAnswerServerSchema>;

export const RtcIceServerSchema = z.object({
  type: z.literal("rtc.ice"),
  from: z.string(),
  candidate: z.unknown(),
});
export type RtcIceServer = z.infer<typeof RtcIceServerSchema>;

// ─── SFU signalling — Client → Server ────────────────────────────────────────

export const SfuGetCapsSchema = z.object({ type: z.literal("sfu.get-caps") });
export const SfuCreateTransportSchema = z.object({
  type: z.literal("sfu.create-transport"),
  direction: z.enum(["send", "recv"]),
});
export const SfuConnectTransportSchema = z.object({
  type: z.literal("sfu.connect-transport"),
  transportId: z.string(),
  direction: z.enum(["send", "recv"]),
  dtlsParameters: z.unknown(),
});
export const SfuProduceSchema = z.object({
  type: z.literal("sfu.produce"),
  transportId: z.string(),
  kind: z.enum(["audio", "video"]),
  rtpParameters: z.unknown(),
});
export const SfuGetProducersSchema = z.object({ type: z.literal("sfu.get-producers") });
export const SfuConsumeSchema = z.object({
  type: z.literal("sfu.consume"),
  transportId: z.string(),
  producerId: z.string(),
  rtpCapabilities: z.unknown(),
});
export const SfuResumeConsumerSchema = z.object({
  type: z.literal("sfu.resume-consumer"),
  consumerId: z.string(),
});
export const SfuLeaveSchema = z.object({ type: z.literal("sfu.leave") });

// ─── SFU signalling — Server → Client ────────────────────────────────────────

export const SfuRouterCapsSchema = z.object({
  type: z.literal("sfu.router-caps"),
  rtpCapabilities: z.unknown(),
});
export const SfuTransportCreatedSchema = z.object({
  type: z.literal("sfu.transport-created"),
  direction: z.enum(["send", "recv"]),
  id: z.string(),
  iceParameters: z.unknown(),
  iceCandidates: z.unknown(),
  dtlsParameters: z.unknown(),
});
export const SfuProducedSchema = z.object({
  type: z.literal("sfu.produced"),
  producerId: z.string(),
  kind: z.enum(["audio", "video"]),
});
export const SfuProducersListSchema = z.object({
  type: z.literal("sfu.producers-list"),
  producers: z.array(z.object({ producerId: z.string(), peerId: z.string(), kind: z.string() })),
});
export const SfuConsumedSchema = z.object({
  type: z.literal("sfu.consumed"),
  consumerId: z.string(),
  producerId: z.string(),
  kind: z.string(),
  rtpParameters: z.unknown(),
  paused: z.boolean(),
  peerId: z.string(),
});
export const SfuNewProducerSchema = z.object({
  type: z.literal("sfu.new-producer"),
  peerId: z.string(),
  producerId: z.string(),
  kind: z.string(),
});
export const SfuProducerClosedSchema = z.object({
  type: z.literal("sfu.producer-closed"),
  producerId: z.string(),
  peerId: z.string(),
});
export const BubbleSfuSwitchSchema = z.object({
  type: z.literal("bubble.sfu-switch"),
  bubbleId: z.string(),
  members: z.array(z.string()),
});

// ─── NPC messages — Server → Client ──────────────────────────────────────────

export const NpcDataSchema = z.object({
  npcId: z.string(),
  x: z.number(),
  y: z.number(),
  facing: FacingSchema,
  spriteKey: z.string(),
  name: z.string(),
});
export type NpcData = z.infer<typeof NpcDataSchema>;

export const NpcStateSchema = NpcDataSchema.extend({ type: z.literal("npc.state") });
export type NpcState = z.infer<typeof NpcStateSchema>;

export const NpcSnapshotSchema = z.object({
  type: z.literal("npc.snapshot"),
  npcs: z.array(NpcDataSchema),
});
export type NpcSnapshot = z.infer<typeof NpcSnapshotSchema>;

export const RoomOccupancySchema = z.object({
  type: z.literal("room.occupancy"),
  counts: z.record(z.string(), z.number()),
});
export type RoomOccupancy = z.infer<typeof RoomOccupancySchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  PlayerMoveSchema,
  PingSchema,
  RtcOfferClientSchema,
  RtcAnswerClientSchema,
  RtcIceClientSchema,
  RtcLeaveClientSchema,
  SfuGetCapsSchema,
  SfuCreateTransportSchema,
  SfuConnectTransportSchema,
  SfuProduceSchema,
  SfuGetProducersSchema,
  SfuConsumeSchema,
  SfuResumeConsumerSchema,
  SfuLeaveSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  WelcomeSchema,
  PlayerJoinedSchema,
  PlayerLeftSchema,
  PlayerStateSchema,
  WorldSnapshotSchema,
  PongSchema,
  BubbleJoinSchema,
  BubbleLeaveSchema,
  BubbleUpdateSchema,
  RtcOfferServerSchema,
  RtcAnswerServerSchema,
  RtcIceServerSchema,
  SfuRouterCapsSchema,
  SfuTransportCreatedSchema,
  SfuProducedSchema,
  SfuProducersListSchema,
  SfuConsumedSchema,
  SfuNewProducerSchema,
  SfuProducerClosedSchema,
  BubbleSfuSwitchSchema,
  NpcStateSchema,
  NpcSnapshotSchema,
  RoomOccupancySchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
