import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";
import { createPairingCode, createRefreshToken, hashPairingCode, type TokenService } from "../crypto/tokens.js";
import type { Authenticator } from "../auth/authenticator.js";
import type { Store } from "../db/store.js";
import { claimPairingSchema, createPairingSchema, pairingCodeQuerySchema, uuidSchema } from "../schemas.js";
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
}
