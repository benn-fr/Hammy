import type { FastifyInstance } from "fastify";
import type { Authenticator } from "../auth/authenticator.js";
import type { Store } from "../db/store.js";
import type { RelayHub } from "../realtime/hub.js";
import { parsePagination } from "./sessions.js";

export async function registerLiveEventRoute(app: FastifyInstance, dependencies: {
  store: Store;
  authenticator: Authenticator;
  hub: RelayHub;
}): Promise<void> {
  app.get<{ Querystring: { after?: string; limit?: string } }>("/v1/events/live", {
    websocket: true,
    preValidation: dependencies.authenticator.requireTrusted,
  }, (socket, request) => {
    const auth = request.auth!;
    const remove = dependencies.hub.add(auth.userId, socket);
    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, 25_000);

    socket.on("close", () => {
      clearInterval(heartbeat);
      remove();
    });
    socket.on("error", () => {
      clearInterval(heartbeat);
      remove();
    });
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string };
        if (message.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
      } catch {
        socket.close(1003, "Messages must be valid JSON");
      }
    });

    void (async () => {
      const { after, limit } = parsePagination(request.query);
      const page = await dependencies.store.listEvents(auth.userId, after, limit + 1);
      const hasMore = page.length > limit;
      const events = page.slice(0, limit);
      socket.send(JSON.stringify({
        type: "ready",
        events,
        nextCursor: events.at(-1)?.cursor ?? after,
        hasMore,
      }));
    })().catch(() => socket.close(1011, "Unable to load event backlog"));
  });
}
