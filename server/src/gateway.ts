import uWS from "uWebSockets.js";
import { v4 as uuidv4 } from "uuid";
import { ClientMessageSchema } from "@fundexecs/virtual-office-shared";
import type { RoomManager } from "./RoomManager";
import type { AuthService } from "./AuthService";
import type { SocketData } from "./Room";

function getQueryParam(query: string, key: string): string | undefined {
  const params = new URLSearchParams(query);
  return params.get(key) ?? undefined;
}

export function createGateway(
  roomManager: RoomManager,
  authService: AuthService
): uWS.TemplatedApp {
  const app = uWS.App();

  app.ws<SocketData>("/ws", {
    idleTimeout: 60,
    maxPayloadLength: 16 * 1024,

    upgrade: async (res, req, context) => {
      const query = req.getQuery();
      const roomId = getQueryParam(query, "roomId");
      const token = getQueryParam(query, "token");

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

      // Abort handling (client disconnected before upgrade completes)
      let aborted = false;
      res.onAborted(() => {
        aborted = true;
      });

      if (aborted) return;

      res.upgrade<SocketData>(
        { playerId: userId, roomId },
        req.getHeader("sec-websocket-key"),
        req.getHeader("sec-websocket-protocol"),
        req.getHeader("sec-websocket-extensions"),
        context
      );
    },

    open: async (ws) => {
      const { playerId, roomId } = ws.getUserData();

      const room = await roomManager.getOrCreateRoom(roomId);

      // If player is already in room (reconnect), remove old entry
      if (room.hasPlayer(playerId)) {
        room.removePlayer(playerId);
      }

      const player = room.addPlayer(ws, playerId, playerId);

      // Send welcome to this player
      room.sendTo(playerId, {
        type: "welcome",
        playerId,
        worldSnapshot: {
          type: "world.snapshot",
          players: room.getSnapshot(),
        },
      });

      // Broadcast player joined to others
      room.broadcast({ type: "player.joined", player }, playerId);
    },

    message: (ws, message, isBinary) => {
      if (isBinary) return;

      const { playerId, roomId } = ws.getUserData();
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      let text: string;
      try {
        text = Buffer.from(message).toString("utf-8");
      } catch {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      const result = ClientMessageSchema.safeParse(parsed);
      if (!result.success) return;

      const msg = result.data;

      if (msg.type === "player.move") {
        const updatedPlayer = room.applyMove(playerId, msg.dx, msg.dy, msg.seq);
        if (updatedPlayer) {
          // Broadcast authoritative state to ALL players (including sender for reconciliation)
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
        room.sendTo(playerId, {
          type: "pong",
          clientTime: msg.clientTime,
          serverTime: Date.now(),
        });
      } else if (msg.type === "rtc.offer") {
        room.relayTo(msg.to, { type: "rtc.offer", from: playerId, sdp: msg.sdp });
      } else if (msg.type === "rtc.answer") {
        room.relayTo(msg.to, { type: "rtc.answer", from: playerId, sdp: msg.sdp });
      } else if (msg.type === "rtc.ice") {
        room.relayTo(msg.to, { type: "rtc.ice", from: playerId, candidate: msg.candidate });
      }
      // rtc.leave is client-only; no server action needed
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
