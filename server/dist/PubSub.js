"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PubSub = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
class PubSub {
    constructor(redisUrl) {
        this.handlers = new Set();
        this.pub = new ioredis_1.default(redisUrl);
        this.sub = new ioredis_1.default(redisUrl);
        this.sub.on("message", (channel, data) => {
            const prefix = "room:";
            if (!channel.startsWith(prefix))
                return;
            const roomId = channel.slice(prefix.length);
            try {
                const message = JSON.parse(data);
                for (const handler of this.handlers) {
                    handler(roomId, message);
                }
            }
            catch {
                // ignore malformed messages
            }
        });
    }
    async subscribeRoom(roomId) {
        await this.sub.subscribe(`room:${roomId}`);
    }
    async unsubscribeRoom(roomId) {
        await this.sub.unsubscribe(`room:${roomId}`);
    }
    async publish(roomId, message) {
        await this.pub.publish(`room:${roomId}`, JSON.stringify(message));
    }
    onMessage(handler) {
        this.handlers.add(handler);
    }
    offMessage(handler) {
        this.handlers.delete(handler);
    }
    async disconnect() {
        await this.pub.quit();
        await this.sub.quit();
    }
}
exports.PubSub = PubSub;
//# sourceMappingURL=PubSub.js.map