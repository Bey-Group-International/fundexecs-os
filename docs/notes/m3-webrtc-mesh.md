# M3 — WebRTC Mesh A/V + Spatial Audio

## Goal
When a proximity bubble forms (M2), the members automatically start a P2P
WebRTC mesh call — video + audio — with no third-party service.  Spatial audio
attenuation is applied client-side based on the distance between avatars.
Mesh is capped at 4 participants (matches `MAX_BUBBLE_SIZE`); M4 handles the
mediasoup upgrade for larger groups.

## Architecture: pure client-side signalling via the existing WS

We already have a WebSocket channel per room.  The server does **not** touch
media — it is purely a **signalling relay**.  New wire messages carry SDP
offers/answers and ICE candidates between peers.

```
Alice                  Server (relay)              Bob
  |  bubble.join  →      |                          |
  |                      |  ←  bubble.join          |
  |  rtc.offer  →        |  →  rtc.offer            |
  |                      |  ←  rtc.answer           |
  |  ←  rtc.answer       |                          |
  |  rtc.ice    →        |  →  rtc.ice              |
  |  ←  rtc.ice          |                          |
  |====== P2P media flows directly ==============|
```

The server simply re-addresses each signalling message from `from` to `to`
(targeted delivery, not broadcast).  This avoids any server-side media
processing.

## New wire messages

### Client → Server
```typescript
{ type: "rtc.offer",   to: string, sdp: string }
{ type: "rtc.answer",  to: string, sdp: string }
{ type: "rtc.ice",     to: string, candidate: RTCIceCandidateInit }
{ type: "rtc.leave" }   // on bubble.leave, tears down all peer connections
```

### Server → Client (relayed)
```typescript
{ type: "rtc.offer",   from: string, sdp: string }
{ type: "rtc.answer",  from: string, sdp: string }
{ type: "rtc.ice",     from: string, candidate: RTCIceCandidateInit }
```

## Client WebRTC layer: `MeshManager`

`components/virtual-office/rtc/MeshManager.ts`

- Owns a `Map<peerId, RTCPeerConnection>` and a `Map<peerId, HTMLAudioElement>`
- `joinBubble(myId, memberIds, localStream)` — initiates offers to all members
  with higher lexicographic id (prevents offer collision)
- `handleOffer/Answer/Ice(from, ...)` — standard trickle-ICE flow
- `leaveBubble()` — closes all peers, removes audio elements
- `updateSpatialGain(peerId, distancePx)` — sets `GainNode` value on the
  peer's audio track using the formula:
  ```
  gain = clamp(1 - (dist - BUBBLE_RADIUS) / HYSTERESIS, 0, 1)
  ```
  At dist ≤ 160 → gain 1.0; at dist ≥ 200 → gain 0.0 (matches hysteresis band)

## Audio pipeline per peer

```
RTCPeerConnection track
  → MediaStreamSource
  → GainNode  (spatial attenuation, updated every Phaser update tick)
  → AudioContext.destination
```

`AudioContext` is lazily created on first user gesture (browser autoplay
policy).

## Camera/mic permission flow

`MediaPermissionBanner` — a thin React component rendered above the canvas:
- Shows "Allow mic/camera to join the call" with a button when the user is in
  a bubble but hasn't granted permission yet
- Disappears once stream is acquired or if the user dismisses it

## Video tiles

`VideoTileBar` — a row of small (120×90 px) `<video>` elements above the
canvas, one per remote peer in the bubble.  Self-tile shows the local stream.
Hidden when no bubble.

## Spatial audio update loop

`OfficeScene.update()` already runs every frame.  After each frame, for every
remote player in `remotePlayers`, compute `Math.hypot(dx, dy)` from local
player and call `meshManager.updateSpatialGain(id, dist)`.

## Server changes

`gateway.ts` — new message handling for `rtc.*` client messages:
```typescript
if (msg.type === "rtc.offer" || msg.type === "rtc.answer" || msg.type === "rtc.ice") {
  room.relayTo(msg.to, { ...msg, type: msg.type, from: playerId });
}
if (msg.type === "rtc.leave") { /* no-op at server level */ }
```

`Room.ts` — add `relayTo(targetId, msg)` (same as `sendTo` but avoids naming
confusion with bubble events).

## ICE configuration

STUN only for M3 (works for most home/office NATs):
```typescript
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
```
TURN (for symmetric NAT) deferred to M4.

## Not in M3
- Screen share — M5
- mediasoup SFU upgrade — M4
- Chat — M5
- TURN server — M4
