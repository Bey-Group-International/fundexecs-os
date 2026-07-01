// Wire message types for the virtual office multiplayer protocol.
// These mirror the server contract exactly — do not add zod or runtime validators here.

export type Facing = "down" | "up" | "left" | "right" | "idle";

export type RemotePlayer = {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  name: string;
  spriteKey: string;
};

// ─── Client → Server ──────────────────────────────────────────────────────────

export type PlayerMoveMessage = {
  type: "player.move";
  dx: number;
  dy: number;
  seq: number;
};

export type PingMessage = {
  type: "ping";
  clientTime: number;
};

export type ClientMessage = PlayerMoveMessage | PingMessage;

// ─── Server → Client ──────────────────────────────────────────────────────────

export type WorldSnapshotMessage = {
  type: "world.snapshot";
  players: RemotePlayer[];
};

export type WelcomeMessage = {
  type: "welcome";
  playerId: string;
  worldSnapshot: WorldSnapshotMessage;
};

export type PlayerJoinedMessage = {
  type: "player.joined";
  player: RemotePlayer;
};

export type PlayerLeftMessage = {
  type: "player.left";
  playerId: string;
};

export type PlayerStateMessage = {
  type: "player.state";
  playerId: string;
  x: number;
  y: number;
  facing: Facing;
  seq: number;
};

export type PongMessage = {
  type: "pong";
  clientTime: number;
  serverTime: number;
};

export type ServerMessage =
  | WelcomeMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PlayerStateMessage
  | PongMessage;
