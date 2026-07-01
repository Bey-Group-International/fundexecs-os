import uWS from "uWebSockets.js";
import type { RoomManager } from "./RoomManager";
import type { AuthService } from "./AuthService";
export declare function createGateway(roomManager: RoomManager, authService: AuthService): uWS.TemplatedApp;
