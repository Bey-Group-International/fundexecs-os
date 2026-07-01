"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGateway = createGateway;
const uWebSockets_js_1 = __importDefault(require("uWebSockets.js"));
const virtual_office_shared_1 = require("@fundexecs/virtual-office-shared");
function getQueryParam(query, key) {
    const params = new URLSearchParams(query);
    return params.get(key) ?? undefined;
}
function handleAsync(fn) {
    fn().catch((err) => console.error("[SFU]", err));
}
function createGateway(roomManager, authService) {
    const app = uWebSockets_js_1.default.App();
    app.ws("/ws", {
        idleTimeout: 60,
        maxPayloadLength: 64 * 1024,
        upgrade: async (res, req, context) => {
            const query = req.getQuery();
            const roomId = getQueryParam(query, "roomId");
            const token = getQueryParam(query, "token");
            if (!roomId || !token) {
                res.writeStatus("400").end("Missing roomId or token");
                return;
            }
            let userId;
            let displayName;
            try {
                const authResult = await authService.validateToken(token);
                userId = authResult.userId;
                displayName = authResult.displayName;
            }
            catch {
                res.writeStatus("401").end("Unauthorized");
                return;
            }
            let aborted = false;
            res.onAborted(() => { aborted = true; });
            if (aborted)
                return;
            res.upgrade({ playerId: userId, roomId }, req.getHeader("sec-websocket-key"), req.getHeader("sec-websocket-protocol"), req.getHeader("sec-websocket-extensions"), context);
        },
        open: async (ws) => {
            const { playerId, roomId } = ws.getUserData();
            const room = await roomManager.getOrCreateRoom(roomId);
            if (room.hasPlayer(playerId))
                room.removePlayer(playerId);
            const player = room.addPlayer(ws, playerId, playerId);
            room.sendTo(playerId, {
                type: "welcome",
                playerId,
                worldSnapshot: { type: "world.snapshot", players: room.getSnapshot() },
            });
            room.broadcast({ type: "player.joined", player }, playerId);
        },
        message: (ws, message, isBinary) => {
            if (isBinary)
                return;
            const { playerId, roomId } = ws.getUserData();
            const room = roomManager.getRoom(roomId);
            if (!room)
                return;
            let text;
            try {
                text = Buffer.from(message).toString("utf-8");
            }
            catch {
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(text);
            }
            catch {
                return;
            }
            const result = virtual_office_shared_1.ClientMessageSchema.safeParse(parsed);
            if (!result.success)
                return;
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
            }
            else if (msg.type === "ping") {
                room.sendTo(playerId, { type: "pong", clientTime: msg.clientTime, serverTime: Date.now() });
            }
            else if (msg.type === "rtc.offer") {
                room.relayTo(msg.to, { type: "rtc.offer", from: playerId, sdp: msg.sdp });
            }
            else if (msg.type === "rtc.answer") {
                room.relayTo(msg.to, { type: "rtc.answer", from: playerId, sdp: msg.sdp });
            }
            else if (msg.type === "rtc.ice") {
                room.relayTo(msg.to, { type: "rtc.ice", from: playerId, candidate: msg.candidate });
                // ── SFU signalling ──────────────────────────────────────────────────────
            }
            else if (msg.type === "sfu.get-caps") {
                handleAsync(async () => {
                    const sfuRoom = room.getSfuRoomForPlayer(playerId);
                    if (!sfuRoom)
                        return;
                    const rtpCapabilities = await sfuRoom.getRouterCapabilities();
                    room.sendTo(playerId, { type: "sfu.router-caps", rtpCapabilities });
                });
            }
            else if (msg.type === "sfu.create-transport") {
                handleAsync(async () => {
                    const sfuRoom = room.getSfuRoomForPlayer(playerId);
                    if (!sfuRoom)
                        return;
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
            }
            else if (msg.type === "sfu.connect-transport") {
                handleAsync(async () => {
                    const sfuRoom = room.getSfuRoomForPlayer(playerId);
                    if (!sfuRoom)
                        return;
                    await sfuRoom.connectTransport(msg.transportId, msg.dtlsParameters);
                });
            }
            else if (msg.type === "sfu.produce") {
                handleAsync(async () => {
                    const sfuRoom = room.getSfuRoomForPlayer(playerId);
                    if (!sfuRoom)
                        return;
                    const { producerId } = await sfuRoom.produce(playerId, msg.transportId, msg.kind, msg.rtpParameters);
                    room.sendTo(playerId, { type: "sfu.produced", producerId, kind: msg.kind });
                    room.broadcastToSfuBubble(playerId, {
                        type: "sfu.new-producer",
                        peerId: playerId,
                        producerId,
                        kind: msg.kind,
                    }, playerId);
                });
            }
            else if (msg.type === "sfu.get-producers") {
                const sfuRoom = room.getSfuRoomForPlayer(playerId);
                if (!sfuRoom)
                    return;
                const producers = sfuRoom.getAllProducers().filter((p) => p.peerId !== playerId);
                room.sendTo(playerId, { type: "sfu.producers-list", producers });
            }
            else if (msg.type === "sfu.consume") {
                handleAsync(async () => {
                    const sfuRoom = room.getSfuRoomForPlayer(playerId);
                    if (!sfuRoom)
                        return;
                    const info = await sfuRoom.consume(playerId, msg.transportId, msg.producerId, msg.rtpCapabilities);
                    if (!info)
                        return;
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
            }
            else if (msg.type === "sfu.resume-consumer") {
                handleAsync(async () => {
                    const sfuRoom = room.getSfuRoomForPlayer(playerId);
                    if (!sfuRoom)
                        return;
                    await sfuRoom.resumeConsumer(msg.consumerId);
                });
            }
            else if (msg.type === "sfu.leave") {
                const sfuRoom = room.getSfuRoomForPlayer(playerId);
                if (!sfuRoom)
                    return;
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
            if (!room)
                return;
            room.removePlayer(playerId);
            room.broadcastAll({ type: "player.left", playerId });
            await roomManager.removeEmptyRoom(roomId);
        },
    });
    return app;
}
//# sourceMappingURL=gateway.js.map