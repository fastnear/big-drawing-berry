import { WS_URL } from "./constants";
import type { DrawEventWS } from "./types";

type EventHandler = (event: DrawEventWS) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: EventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTimestamp = 0;

  connect() {
    if (this.ws) return;

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log("WebSocket connected");
      // Request catch-up if we have a last known timestamp
      if (this.lastTimestamp > 0) {
        this.ws!.send(
          JSON.stringify({
            type: "catch_up",
            since_timestamp_ms: this.lastTimestamp,
          })
        );
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const event: DrawEventWS = JSON.parse(e.data);
        if (event.type === "draw") {
          this.lastTimestamp = Math.max(this.lastTimestamp, event.block_timestamp_ms);
          for (const handler of this.handlers) {
            handler(event);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      console.log("WebSocket disconnected, reconnecting...");
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  onDraw(handler: EventHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
