import uWS from "uWebSockets.js";
import { ClientMessageSchema } from "@fundexecs/virtual-office-shared";
import type { RoomManager } from "./RoomManager";
import type { AuthService } from "./AuthService";
import type { SocketData } from "./Room";

function getQueryParam(query: string, key: string): string | undefined {
  const params = new URLSearchParams(query);
  return params.get(key) ?? undefined;
}

function handleAsync(fn: () => Promise<void>): void {
  fn().catch((err) => console.error("[SFU]", err));
}

export function createGateway(
  roomManager: RoomManager,
  authService: AuthService
): uWS.TemplatedApp {
  const app = uWS.App();

  app.ws<SocketData>("/ws", {
    idleTimeout: 60,
    maxPayloadLength: 64 * 1024,

    upgrade: async (res, req, context) => {
      const query = req.getQuery();
      const roomId = getQueryParam(query, "roomId");
      const token = getQueryParam(query, "token");
      const characterId = getQueryParam(query, "characterId") ?? "player_default";

      if (!roomId || !token) {
        res.writeStatus("400").end("Missing roomId or token");
        return;
      }

      let userId: string;
      let displayName: string;

      try {
        const authResult = await authService.validateToken(token);
        userId = authResult.userId;
        displayName = authResult.displayName;
      } catch {
        res.writeStatus("401").end("Unauthorized");
        return;
      }

      let aborted = false;
      res.onAborted(() => { aborted = true; });
      if (aborted) return;

      res.upgrade<SocketData>(
        { playerId: userId, roomId, displayName, characterId },
        req.getHeader("sec-websocket-key"),
        req.getHeader("sec-websocket-protocol"),
        req.getHeader("sec-websocket-extensions"),
        context
      );
    },

    open: async (ws) => {
      const { playerId, roomId, displayName, characterId } = ws.getUserData();
      const room = await roomManager.getOrCreateRoom(roomId);

      if (room.hasPlayer(playerId)) room.removePlayer(playerId);

      const player = room.addPlayer(ws, playerId, displayName, characterId);

      room.sendTo(playerId, {
        type: "welcome",
        playerId,
        worldSnapshot: { type: "world.snapshot", players: room.getSnapshot() },
      });

      room.sendTo(playerId, { type: "npc.snapshot", npcs: room.getNpcSnapshot() });

      room.broadcast({ type: "player.joined", player }, playerId);
    },

    message: (ws, message, isBinary) => {
      if (isBinary) return;

      const { playerId, roomId } = ws.getUserData();
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      let text: string;
      try { text = Buffer.from(message).toString("utf-8"); } catch { return; }

      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return; }

      const result = ClientMessageSchema.safeParse(parsed);
      if (!result.success) return;

      const msg = result.data;

      if (msg.type === "player.move") {
        const updatedPlayer = room.applyMove(playerId, msg.dx, msg.dy, msg.seq);
        if (updatedPlayer) {
          room.broadcastAll({
            type: "player.state",
            playerId,
            x: updatedPlayer.x,
            y: updatedPlayer.y,
            facing: updatedPlayer.facing,
            seq: msg.seq,
          });
        }

      } else if (msg.type === "ping") {
        room.sendTo(playerId, { type: "pong", clientTime: msg.clientTime, serverTime: Date.now() });

      } else if (msg.type === "rtc.offer") {
        room.relayTo(msg.to, { type: "rtc.offer", from: playerId, sdp: msg.sdp });
      } else if (msg.type === "rtc.answer") {
        room.relayTo(msg.to, { type: "rtc.answer", from: playerId, sdp: msg.sdp });
      } else if (msg.type === "rtc.ice") {
        room.relayTo(msg.to, { type: "rtc.ice", from: playerId, candidate: msg.candidate });

      // ── SFU signalling ──────────────────────────────────────────────────────
      } else if (msg.type === "sfu.get-caps") {
        handleAsync(async () => {
          const sfuRoom = room.getSfuRoomForPlayer(playerId);
          if (!sfuRoom) return;
          const rtpCapabilities = await sfuRoom.getRouterCapabilities();
          room.sendTo(playerId, { type: "sfu.router-caps", rtpCapabilities });
        });

      } else if (msg.type === "sfu.create-transport") {
        handleAsync(async () => {
          const sfuRoom = room.getSfuRoomForPlayer(playerId);
          if (!sfuRoom) return;
          const info = await sfuRoom.createTransport(playerId, msg.direction);
          room.sendTo(playerId, {
            type: "sfu.transport-created",
            direction: info.direction,
            id: info.id,
            iceParameters: info.iceParameters,
            iceCandidates: info.iceCandidates,
            dtlsParameters: info.dtlsParameters,
          });
        });

      } else if (msg.type === "sfu.connect-transport") {
        handleAsync(async () => {
          const sfuRoom = room.getSfuRoomForPlayer(playerId);
          if (!sfuRoom) return;
          await sfuRoom.connectTransport(msg.transportId, msg.dtlsParameters);
        });

      } else if (msg.type === "sfu.produce") {
        handleAsync(async () => {
          const sfuRoom = room.getSfuRoomForPlayer(playerId);
          if (!sfuRoom) return;
          const { producerId } = await sfuRoom.produce(
            playerId, msg.transportId, msg.kind, msg.rtpParameters
          );
          room.sendTo(playerId, { type: "sfu.produced", producerId, kind: msg.kind });
          room.broadcastToSfuBubble(playerId, {
            type: "sfu.new-producer",
            peerId: playerId,
            producerId,
            kind: msg.kind,
          }, playerId);
        });

      } else if (msg.type === "sfu.get-producers") {
        const sfuRoom = room.getSfuRoomForPlayer(playerId);
        if (!sfuRoom) return;
        const producers = sfuRoom.getAllProducers().filter((p) => p.peerId !== playerId);
        room.sendTo(playerId, { type: "sfu.producers-list", producers });

      } else if (msg.type === "sfu.consume") {
        handleAsync(async () => {
          const sfuRoom = room.getSfuRoomForPlayer(playerId);
          if (!sfuRoom) return;
          const info = await sfuRoom.consume(
            playerId, msg.transportId, msg.producerId, msg.rtpCapabilities
          );
          if (!info) return;
          room.sendTo(playerId, {
            type: "sfu.consumed",
            consumerId: info.consumerId,
            producerId: info.producerId,
            kind: info.kind,
            rtpParameters: info.rtpParameters,
            paused: info.paused,
            peerId: info.peerId,
          });
        });

      } else if (msg.type === "sfu.resume-consumer") {
        handleAsync(async () => {
          const sfuRoom = room.getSfuRoomForPlayer(playerId);
          if (!sfuRoom) return;
          await sfuRoom.resumeConsumer(msg.consumerId);
        });

      } else if (msg.type === "sfu.leave") {
        const sfuRoom = room.getSfuRoomForPlayer(playerId);
        if (!sfuRoom) return;
        const closedIds = sfuRoom.removePeer(playerId);
        for (const producerId of closedIds) {
          room.broadcastToSfuBubble(playerId, {
            type: "sfu.producer-closed",
            producerId,
            peerId: playerId,
          }, playerId);
        }
      }
    },

    close: async (ws, _code, _message) => {
      const { playerId, roomId } = ws.getUserData();
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      room.removePlayer(playerId);
      room.broadcastAll({ type: "player.left", playerId });

      await roomManager.removeEmptyRoom(roomId);
    },
  });

  return app;
}
