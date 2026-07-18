import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";
import { createPairingCode, createRefreshToken, hashPairingCode, type TokenService } from "../crypto/tokens.js";
import type { Authenticator } from "../auth/authenticator.js";
import type { Store } from "../db/store.js";
import {
  claimPairingLobbySchema,
  claimPairingSchema,
  createPairingLobbySchema,
  createPairingSchema,
  pairingCodeQuerySchema,
  uuidSchema,
} from "../schemas.js";
import { presentDevice } from "./presentation.js";

export async function registerPairingRoutes(app: FastifyInstance, dependencies: {
  store: Store;
  tokens: TokenService;
  authenticator: Authenticator;
  refreshTokenTTLDays: number;
  accessTokenTTLSeconds: number;
}): Promise<void> {
  async function issueSession(userId: string, deviceId: string) {
    const id = randomUUID();
    const refresh = createRefreshToken(id);
    const expiresAt = new Date(Date.now() + dependencies.refreshTokenTTLDays * 86_400_000).toISOString();
    await dependencies.store.createAuthSession({ id, userId, deviceId, refreshTokenHash: refresh.hash, expiresAt });
    return {
      accessToken: await dependencies.tokens.issueAccessToken({ userId, deviceId, authSessionId: id, trusted: true }),
      refreshToken: refresh.token,
      tokenType: "Bearer",
      expiresIn: dependencies.accessTokenTTLSeconds,
    };
  }

  app.post("/v1/pairings", { preHandler: dependencies.authenticator.requireTrusted }, async (request, reply) => {
    createPairingSchema.parse(request.body);
    const generated = createPairingCode();
    const pairing = await dependencies.store.createPairing({
      id: randomUUID(),
      userId: request.auth!.userId,
      creatorDeviceId: request.auth!.deviceId,
      codeHash: generated.hash,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    return reply.code(201).send({ pairingId: pairing.id, code: generated.code, expiresAt: pairing.expiresAt });
  });

  app.get<{ Params: { pairingId: string } }>("/v1/pairings/:pairingId", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async (request) => {
    const pairingId = uuidSchema.parse(request.params.pairingId);
    const pairing = await dependencies.store.getPairing(request.auth!.userId, pairingId);
    if (!pairing) throw new AppError("Pairing was not found", 404, "not_found");
    const device = pairing.claimedDeviceId
      ? await dependencies.store.getDevice(request.auth!.userId, pairing.claimedDeviceId)
      : null;
    return {
      pairingId: pairing.id,
      expiresAt: pairing.expiresAt,
      consumed: Boolean(pairing.consumedAt),
      device: device ? presentDevice(device) : null,
    };
  });

  app.post("/v1/pairings/claim", {
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
  }, async (request) => {
    const input = claimPairingSchema.parse(request.body);
    const pairing = await dependencies.store.claimPairing(hashPairingCode(input.code), input.device);
    if (!pairing) throw new AppError("Pairing code is invalid, expired, or already used", 404, "invalid_pairing_code");
    return { pairingId: pairing.id, expiresAt: pairing.expiresAt };
  });

  app.get<{ Params: { pairingId: string }; Querystring: { code?: string } }>("/v1/pairings/:pairingId/complete", {
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async (request) => {
    const pairingId = uuidSchema.parse(request.params.pairingId);
    const { code } = pairingCodeQuerySchema.parse(request.query);
    const pairing = await dependencies.store.consumePairing(pairingId, hashPairingCode(code));
    if (!pairing) throw new AppError("Pairing is still awaiting companion approval", 409, "pairing_pending");
    const device = await dependencies.store.getDevice(pairing.userId, pairing.claimedDeviceId!);
    if (!device) throw new AppError("Paired device was not found", 404, "not_found");
    const tokens = await issueSession(pairing.userId, device.id);
    return { userId: pairing.userId, device: presentDevice(device), tokens };
  });

  // Phone-initiated pairing supports discovery through the relay even when the
  // two devices are on different networks. The discoverable list reveals only
  // random lobby IDs and expiry; the code remains the proof of possession.
  app.post("/v1/pairing-lobbies", {
    config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const input = createPairingLobbySchema.parse(request.body);
    const generated = createPairingCode();
    const lobby = await dependencies.store.createPairingLobby({
      id: randomUUID(),
      codeHash: generated.hash,
      device: input.device,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    return reply.code(201).send({ lobbyId: lobby.id, code: generated.code, expiresAt: lobby.expiresAt });
  });

  app.get("/v1/pairing-lobbies", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async () => ({ lobbies: await dependencies.store.listOpenPairingLobbies() }));

  app.post<{ Params: { lobbyId: string } }>("/v1/pairing-lobbies/:lobbyId/claim", {
    preHandler: dependencies.authenticator.requireTrusted,
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async (request) => {
    const lobbyId = uuidSchema.parse(request.params.lobbyId);
    const input = claimPairingLobbySchema.parse(request.body);
    const lobby = await dependencies.store.claimPairingLobby({
      lobbyId,
      codeHash: hashPairingCode(input.code),
      userId: request.auth!.userId,
      creatorDeviceId: request.auth!.deviceId,
    });
    if (!lobby || !lobby.claimedDeviceId) {
      throw new AppError("Pairing code is invalid, expired, or already used", 404, "invalid_pairing_code");
    }
    const device = await dependencies.store.getDevice(request.auth!.userId, lobby.claimedDeviceId);
    if (!device) throw new AppError("Pairing device was not found", 404, "not_found");
    return { lobbyId: lobby.id, expiresAt: lobby.expiresAt, device: presentDevice(device) };
  });

  app.get<{ Params: { lobbyId: string }; Querystring: { code?: string } }>("/v1/pairing-lobbies/:lobbyId/complete", {
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async (request) => {
    const lobbyId = uuidSchema.parse(request.params.lobbyId);
    const { code } = pairingCodeQuerySchema.parse(request.query);
    const lobby = await dependencies.store.consumePairingLobby(lobbyId, hashPairingCode(code));
    if (!lobby?.userId || !lobby.claimedDeviceId) {
      throw new AppError("Pairing is still awaiting companion approval", 409, "pairing_pending");
    }
    const device = await dependencies.store.getDevice(lobby.userId, lobby.claimedDeviceId);
    if (!device) throw new AppError("Paired device was not found", 404, "not_found");
    const tokens = await issueSession(lobby.userId, device.id);
    return { userId: lobby.userId, device: presentDevice(device), tokens };
  });
}
