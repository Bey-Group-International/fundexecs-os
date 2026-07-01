"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomManager = void 0;
const Room_1 = require("./Room");
class RoomManager {
    constructor(pubsub, worker) {
        this.rooms = new Map();
        this.pubsub = pubsub;
        this.worker = worker;
    }
    async getOrCreateRoom(roomId) {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = new Room_1.Room(roomId, this.pubsub, this.worker);
            this.rooms.set(roomId, room);
            await this.pubsub.subscribeRoom(roomId);
        }
        return room;
    }
    getRoom(roomId) {
        return this.rooms.get(roomId);
    }
    async removeEmptyRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (room && room.playerCount === 0) {
            room.close();
            this.rooms.delete(roomId);
            await this.pubsub.unsubscribeRoom(roomId);
        }
    }
}
exports.RoomManager = RoomManager;
//# sourceMappingURL=RoomManager.js.map