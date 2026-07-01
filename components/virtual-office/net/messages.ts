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

// ─── SFU — Client → Server ────────────────────────────────────────────────────

export type SfuGetCapsMessage = { type: "sfu.get-caps" };
export type SfuCreateTransportMessage = { type: "sfu.create-transport"; direction: "send" | "recv" };
export type SfuConnectTransportMessage = {
  type: "sfu.connect-transport";
  transportId: string;
  direction: "send" | "recv";
  dtlsParameters: unknown;
};
export type SfuProduceMessage = {
  type: "sfu.produce";
  transportId: string;
  kind: "audio" | "video";
  rtpParameters: unknown;
};
export type SfuGetProducersMessage = { type: "sfu.get-producers" };
export type SfuConsumeMessage = {
  type: "sfu.consume";
  transportId: string;
  producerId: string;
  rtpCapabilities: unknown;
};
export type SfuResumeConsumerMessage = { type: "sfu.resume-consumer"; consumerId: string };
export type SfuLeaveMessage = { type: "sfu.leave" };

export type ClientMessage =
  | PlayerMoveMessage
  | PingMessage
  | RtcOfferClientMessage
  | RtcAnswerClientMessage
  | RtcIceClientMessage
  | RtcLeaveClientMessage
  | SfuGetCapsMessage
  | SfuCreateTransportMessage
  | SfuConnectTransportMessage
  | SfuProduceMessage
  | SfuGetProducersMessage
  | SfuConsumeMessage
  | SfuResumeConsumerMessage
  | SfuLeaveMessage;

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

// ─── SFU — Server → Client ────────────────────────────────────────────────────

export type SfuRouterCapsMessage = { type: "sfu.router-caps"; rtpCapabilities: unknown };
export type SfuTransportCreatedMessage = {
  type: "sfu.transport-created";
  direction: "send" | "recv";
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
};
export type SfuProducedMessage = { type: "sfu.produced"; producerId: string; kind: "audio" | "video" };
export type SfuProducersListMessage = {
  type: "sfu.producers-list";
  producers: Array<{ producerId: string; peerId: string; kind: string }>;
};
export type SfuConsumedMessage = {
  type: "sfu.consumed";
  consumerId: string;
  producerId: string;
  kind: string;
  rtpParameters: unknown;
  paused: boolean;
  peerId: string;
};
export type SfuNewProducerMessage = { type: "sfu.new-producer"; peerId: string; producerId: string; kind: string };
export type SfuProducerClosedMessage = { type: "sfu.producer-closed"; producerId: string; peerId: string };
export type BubbleSfuSwitchMessage = { type: "bubble.sfu-switch"; bubbleId: string; members: string[] };

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
  | RtcIceServerMessage
  | SfuRouterCapsMessage
  | SfuTransportCreatedMessage
  | SfuProducedMessage
  | SfuProducersListMessage
  | SfuConsumedMessage
  | SfuNewProducerMessage
  | SfuProducerClosedMessage
  | BubbleSfuSwitchMessage;
