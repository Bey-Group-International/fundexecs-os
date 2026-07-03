import * as mediasoup from "mediasoup";
import { createGateway } from "./gateway";
import { RoomManager } from "./RoomManager";
import { AuthService } from "./AuthService";
import { PubSub } from "./PubSub";

const PORT = parseInt(process.env["PORT"] ?? "4000", 10);
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const SUPABASE_JWT_SECRET = process.env["SUPABASE_JWT_SECRET"] ?? "";

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

  const pubsub = new PubSub(REDIS_URL);
  const roomManager = new RoomManager(pubsub, worker);
  if (!SUPABASE_JWT_SECRET) {
    console.error(
      "SUPABASE_JWT_SECRET is not set — the gateway will reject every connection. " +
        "Set it (Supabase → Project Settings → API → JWT Secret) before serving traffic.",
    );
  }
  const authService = new AuthService(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET);

  const app = createGateway(roomManager, authService);

  // HTTP health check
  app.get("/health", (res) => {
    res.writeStatus("200").writeHeader("Content-Type", "application/json").end(
      JSON.stringify({ status: "ok", ts: Date.now() })
    );
  });

  app.listen(PORT, (token) => {
    if (token) {
      console.log(`Virtual Office WS server listening on port ${PORT}`);
      console.log(`WebSocket: ws://0.0.0.0:${PORT}/ws?roomId=<id>&token=<jwt>`);
      console.log(`Health: http://0.0.0.0:${PORT}/health`);
    } else {
      console.error(`Failed to listen on port ${PORT}`);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
