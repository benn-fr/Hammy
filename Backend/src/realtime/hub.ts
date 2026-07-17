import type { WebSocket } from "ws";
import type { EncryptedEventRecord } from "../types.js";

export class RelayHub {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket): () => void {
    const userSockets = this.sockets.get(userId) ?? new Set<WebSocket>();
    userSockets.add(socket);
    this.sockets.set(userId, userSockets);
    return () => {
      userSockets.delete(socket);
      if (userSockets.size === 0) this.sockets.delete(userId);
    };
  }

  publish(event: EncryptedEventRecord): void {
    const message = JSON.stringify({ type: "event", event });
    for (const socket of this.sockets.get(event.userId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  }

  closeAll(): void {
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) socket.close(1001, "Server shutting down");
    }
    this.sockets.clear();
  }
}

