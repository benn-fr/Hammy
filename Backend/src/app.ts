import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { TokenService } from "./crypto/tokens.js";
import { MemoryStore } from "./db/memory-store.js";
import { PostgresStore } from "./db/postgres-store.js";
import { ConflictError, KeyRotationRequiredError, NonceReuseError, type Store } from "./db/store.js";
import { AppError } from "./errors.js";
import { AuthenticationError, AuthorizationError, createAuthenticator } from "./auth/authenticator.js";
import { RelayHub } from "./realtime/hub.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerLiveEventRoute } from "./routes/live-events.js";
import { registerPairingRoutes } from "./routes/pairings.js";
import { registerSessionRoutes } from "./routes/sessions.js";

export async function buildApp(options: { config: AppConfig; store?: Store }) {
  const app = Fastify({
    logger: { level: options.config.logLevel },
    bodyLimit: 1_600_000,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    trustProxy: options.config.trustProxy,
  });
  const store = options.store ?? (options.config.inMemory
    ? new MemoryStore()
    : new PostgresStore(options.config.databaseURL!));
  const tokens = new TokenService(options.config.jwtSecret, options.config.accessTokenTTLSeconds);
  const authenticator = createAuthenticator(store, tokens);
  const hub = new RelayHub();

  app.decorateRequest("auth", null);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(cors, {
    credentials: false,
    origin: options.config.corsOrigins.length === 0
      ? false
      : (origin, callback) => callback(null, !origin || options.config.corsOrigins.includes(origin)),
  });
  await app.register(websocket, { options: { maxPayload: 1_600_000 } });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => {
    await store.healthCheck();
    return { status: "ready" };
  });

  await registerAuthRoutes(app, {
    store,
    tokens,
    authenticator,
    refreshTokenTTLDays: options.config.refreshTokenTTLDays,
    accessTokenTTLSeconds: options.config.accessTokenTTLSeconds,
  });
  await registerDeviceRoutes(app, { store, authenticator });
  await registerPairingRoutes(app, {
    store,
    tokens,
    authenticator,
    refreshTokenTTLDays: options.config.refreshTokenTTLDays,
    accessTokenTTLSeconds: options.config.accessTokenTTLSeconds,
  });
  await registerSessionRoutes(app, { store, authenticator, hub });
  await registerLiveEventRoute(app, { store, authenticator, hub });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "invalid_request", message: "Request validation failed", issues: error.issues } });
    }
    if (error instanceof AuthenticationError) {
      return reply.code(401).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AuthorizationError) {
      return reply.code(403).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof NonceReuseError) {
      return reply.code(409).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof KeyRotationRequiredError) {
      return reply.code(409).send({ error: { code: error.code, message: error.message } });
    }
    const frameworkStatus = (error as { statusCode?: number }).statusCode;
    if (frameworkStatus && frameworkStatus >= 400 && frameworkStatus < 500) {
      const rateLimited = frameworkStatus === 429;
      return reply.code(frameworkStatus).send({
        error: {
          code: rateLimited ? "rate_limited" : "invalid_request",
          message: rateLimited ? "Too many requests" : "The request could not be parsed",
        },
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({ error: { code: "internal_error", message: "The request could not be completed" } });
  });

  app.addHook("onClose", async () => {
    hub.closeAll();
    await store.close();
  });

  return { app, store, hub };
}
