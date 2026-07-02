"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mediasoup = __importStar(require("mediasoup"));
const gateway_1 = require("./gateway");
const RoomManager_1 = require("./RoomManager");
const AuthService_1 = require("./AuthService");
const PubSub_1 = require("./PubSub");
const PORT = parseInt(process.env["PORT"] ?? "4000", 10);
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
async function main() {
    const worker = await mediasoup.createWorker({
        logLevel: "warn",
        rtcMinPort: parseInt(process.env["RTC_MIN_PORT"] ?? "40000", 10),
        rtcMaxPort: parseInt(process.env["RTC_MAX_PORT"] ?? "49999", 10),
    });
    worker.on("died", () => {
        console.error("mediasoup Worker died, exiting...");
        process.exit(1);
    });
    const pubsub = new PubSub_1.PubSub(REDIS_URL);
    const roomManager = new RoomManager_1.RoomManager(pubsub, worker);
    const authService = new AuthService_1.AuthService(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const app = (0, gateway_1.createGateway)(roomManager, authService);
    // HTTP health check
    app.get("/health", (res) => {
        res.writeStatus("200").writeHeader("Content-Type", "application/json").end(JSON.stringify({ status: "ok", ts: Date.now() }));
    });
    app.listen(PORT, (token) => {
        if (token) {
            console.log(`Virtual Office WS server listening on port ${PORT}`);
            console.log(`WebSocket: ws://0.0.0.0:${PORT}/ws?roomId=<id>&token=<jwt>`);
            console.log(`Health: http://0.0.0.0:${PORT}/health`);
        }
        else {
            console.error(`Failed to listen on port ${PORT}`);
            process.exit(1);
        }
    });
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map