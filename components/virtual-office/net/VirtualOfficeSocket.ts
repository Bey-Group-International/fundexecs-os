import type { ClientMessage, ServerMessage } from "./messages";

type MessageHandler = (msg: ServerMessage) => void;

// In production set NEXT_PUBLIC_WS_URL=wss://your-server.up.railway.app
// Falls back to local dev server
const WS_URL_BASE =
  (typeof process !== "undefined" && process.env["NEXT_PUBLIC_WS_URL"])
    ? `${process.env["NEXT_PUBLIC_WS_URL"]}/ws`
    : "ws://localhost:4000/ws";
const PING_INTERVAL_MS = 5_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 5;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;

export type ConnectionStatus = "connected" | "reconnecting" | "failed" | "disconnected";

type StatusHandler = (status: ConnectionStatus) => void;

export class VirtualOfficeSocket {
  private ws: WebSocket | null = null;
  private token: string = "";
  private roomId: string = "office-main";
  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private status: ConnectionStatus = "disconnected";

  private characterId: string = "player_default";

  connect(token: string, roomId = "office-main", characterId = "player_default"): void {
    this.token = token;
    this.roomId = roomId;
    this.characterId = characterId;
    this.intentionallyClosed = false;
    this.retryCount = 0;
    this._openSocket();
  }

  sendMove(dx: number, dy: number, seq: number): void {
    this._send({ type: "player.move", dx, dy, seq });
  }

  sendPing(): void {
    this._send({ type: "ping", clientTime: Date.now() });
  }

  sendRtc(msg: import("./messages").RtcOfferClientMessage | import("./messages").RtcAnswerClientMessage | import("./messages").RtcIceClientMessage | import("./messages").RtcLeaveClientMessage): void {
    this._send(msg);
  }

  sendSfu(msg: import("./messages").SfuGetCapsMessage | import("./messages").SfuCreateTransportMessage | import("./messages").SfuConnectTransportMessage | import("./messages").SfuProduceMessage | import("./messages").SfuGetProducersMessage | import("./messages").SfuConsumeMessage | import("./messages").SfuResumeConsumerMessage | import("./messages").SfuLeaveMessage): void {
    this._send(msg);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onStatusChange(handler: StatusHandler): void {
    this.statusHandlers.push(handler);
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this._clearTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._setStatus("disconnected");
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _openSocket(): void {
    const url = `${WS_URL_BASE}?roomId=${encodeURIComponent(this.roomId)}&token=${encodeURIComponent(this.token)}&characterId=${encodeURIComponent(this.characterId)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retryCount = 0;
      this._setStatus("connected");
      this._startHeartbeat();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this._resetPongTimeout();
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        for (const h of this.messageHandlers) h(msg);
      } catch {
        // Malformed message — ignore silently
      }
    };

    this.ws.onerror = () => {
      // onerror always precedes onclose; let onclose handle reconnect
    };

    this.ws.onclose = () => {
      this._clearTimers();
      if (!this.intentionallyClosed) {
        this._scheduleReconnect();
      }
    };
  }

  private _send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private _scheduleReconnect(): void {
    if (this.retryCount >= MAX_RETRIES) {
      this._setStatus("failed");
      return;
    }
    this._setStatus("reconnecting");
    const delay = BACKOFF_MS[this.retryCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this._openSocket();
    }, delay);
  }

  private _startHeartbeat(): void {
    this._clearTimers();
    this.pingTimer = setInterval(() => {
      this.sendPing();
      // If no pong arrives within PONG_TIMEOUT_MS, consider connection stale
      this.pongTimer = setTimeout(() => {
        this.ws?.close();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private _resetPongTimeout(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private _clearTimers(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this._resetPongTimeout();
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private _setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }
}
