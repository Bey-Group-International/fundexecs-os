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

export type RtcOfferClientMessage = {
  type: "rtc.offer";
  to: string;
  sdp: string;
};

export type RtcAnswerClientMessage = {
  type: "rtc.answer";
  to: string;
  sdp: string;
};

export type RtcIceClientMessage = {
  type: "rtc.ice";
  to: string;
  candidate: RTCIceCandidateInit;
};

export type RtcLeaveClientMessage = {
  type: "rtc.leave";
};

export type ClientMessage =
  | PlayerMoveMessage
  | PingMessage
  | RtcOfferClientMessage
  | RtcAnswerClientMessage
  | RtcIceClientMessage
  | RtcLeaveClientMessage;

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

export type BubbleJoinMessage = {
  type: "bubble.join";
  bubbleId: string;
  members: string[];
};

export type BubbleLeaveMessage = {
  type: "bubble.leave";
  bubbleId: string;
};

export type BubbleUpdateMessage = {
  type: "bubble.update";
  bubbleId: string;
  members: string[];
};

export type RtcOfferServerMessage = {
  type: "rtc.offer";
  from: string;
  sdp: string;
};

export type RtcAnswerServerMessage = {
  type: "rtc.answer";
  from: string;
  sdp: string;
};

export type RtcIceServerMessage = {
  type: "rtc.ice";
  from: string;
  candidate: RTCIceCandidateInit;
};

export type ServerMessage =
  | WelcomeMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PlayerStateMessage
  | PongMessage
  | BubbleJoinMessage
  | BubbleLeaveMessage
  | BubbleUpdateMessage
  | RtcOfferServerMessage
  | RtcAnswerServerMessage
  | RtcIceServerMessage;
