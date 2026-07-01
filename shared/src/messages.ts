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

export const ClientMessageSchema = z.discriminatedUnion("type", [
  PlayerMoveSchema,
  PingSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

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
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
