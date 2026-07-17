import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";
import { hashPassword, verifyPassword } from "../crypto/password.js";
import { loginProofPayload } from "../crypto/canonical.js";
import { verifyEd25519 } from "../crypto/signatures.js";
import {
  createLoginChallenge,
  createRefreshToken,
  hashLoginChallenge,
  parseRefreshToken,
  type TokenService,
} from "../crypto/tokens.js";
import type { Store } from "../db/store.js";
import { loginChallengeSchema, loginSchema, refreshSchema, registerSchema } from "../schemas.js";
import type { Authenticator } from "../auth/authenticator.js";
import { presentDevice, presentUser } from "./presentation.js";

export async function registerAuthRoutes(app: FastifyInstance, dependencies: {
  store: Store;
  tokens: TokenService;
  authenticator: Authenticator;
  refreshTokenTTLDays: number;
  accessTokenTTLSeconds: number;
}): Promise<void> {
  const dummyHash = await hashPassword("hammy-dummy-password-that-is-never-valid");

  async function issueSession(userId: string, deviceId: string, trusted: boolean) {
    const authSessionId = randomUUID();
    const refresh = createRefreshToken(authSessionId);
    const expiresAt = new Date(Date.now() + dependencies.refreshTokenTTLDays * 86_400_000).toISOString();
    await dependencies.store.createAuthSession({
      id: authSessionId,
      userId,
      deviceId,
      refreshTokenHash: refresh.hash,
      expiresAt,
    });
    const accessToken = await dependencies.tokens.issueAccessToken({ userId, deviceId, authSessionId, trusted });
    return {
      accessToken,
      refreshToken: refresh.token,
      tokenType: "Bearer",
      expiresIn: dependencies.accessTokenTTLSeconds,
    };
  }

  app.post("/v1/auth/register", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password);
    const { user, device } = await dependencies.store.createAccount({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      device: input.device,
    });
    const tokens = await issueSession(user.id, device.id, true);
    return reply.code(201).send({ user: presentUser(user), device: presentDevice(device), tokens });
  });

  app.post("/v1/auth/login", {
    config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
  }, async (request) => {
    const input = loginSchema.parse(request.body);
    const user = await dependencies.store.getUserByEmail(input.email);
    const passwordValid = await verifyPassword(user?.passwordHash ?? dummyHash, input.password);
    if (!user || !passwordValid) throw new AppError("Email or password is incorrect", 401, "invalid_credentials");

    let device;
    if (input.deviceId) {
      device = await dependencies.store.getDevice(user.id, input.deviceId);
      if (!device || device.trustState === "revoked" || !input.deviceProof) {
        throw new AppError("Device proof is invalid", 401, "invalid_device_proof");
      }
      const proofPayload = loginProofPayload({
        userId: user.id,
        deviceId: device.id,
        challengeId: input.deviceProof.challengeId,
        challenge: input.deviceProof.challenge,
      });
      const signatureValid = verifyEd25519(device.signingPublicKey, proofPayload, input.deviceProof.signature);
      const challengeValid = signatureValid && await dependencies.store.consumeLoginChallenge({
        id: input.deviceProof.challengeId,
        userId: user.id,
        deviceId: device.id,
        challengeHash: hashLoginChallenge(input.deviceProof.challenge),
      });
      if (!challengeValid) throw new AppError("Device proof is invalid or expired", 401, "invalid_device_proof");
    } else {
      device = await dependencies.store.createPendingDevice(user.id, input.newDevice!);
    }
    if (!device || device.trustState === "revoked") {
      throw new AppError("This device is not registered for the account", 401, "invalid_device");
    }
    const tokens = await issueSession(user.id, device.id, device.trustState === "trusted");
    return { user: presentUser(user), device: presentDevice(device), tokens };
  });

  app.post("/v1/auth/challenge", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request) => {
    const startedAt = Date.now();
    const input = loginChallengeSchema.parse(request.body);
    const challengeId = randomUUID();
    const generated = createLoginChallenge();
    const expiresIn = 120;
    const expiresAt = new Date(Date.now() + expiresIn * 1_000).toISOString();
    const user = await dependencies.store.getUserByEmail(input.email);
    const device = user ? await dependencies.store.getDevice(user.id, input.deviceId) : null;
    if (user && device && device.trustState !== "revoked") {
      await dependencies.store.createLoginChallenge({
        id: challengeId,
        userId: user.id,
        deviceId: device.id,
        challengeHash: generated.hash,
        expiresAt,
      });
    }
    // Unknown account/device pairs receive an indistinguishable synthetic challenge.
    const minimumResponseTime = 75;
    const remainingDelay = minimumResponseTime - (Date.now() - startedAt);
    if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    return { challengeId, challenge: generated.challenge, expiresIn };
  });

  app.post("/v1/auth/refresh", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request) => {
    const input = refreshSchema.parse(request.body);
    let parsed: ReturnType<typeof parseRefreshToken>;
    try {
      parsed = parseRefreshToken(input.refreshToken);
    } catch {
      throw new AppError("Refresh token is invalid", 401, "invalid_refresh_token");
    }
    const next = createRefreshToken(parsed.authSessionId);
    const nextExpiresAt = new Date(Date.now() + dependencies.refreshTokenTTLDays * 86_400_000).toISOString();
    const authSession = await dependencies.store.rotateAuthSession({
      authSessionId: parsed.authSessionId,
      presentedHash: parsed.hash,
      nextHash: next.hash,
      nextExpiresAt,
    });
    if (!authSession) {
      await dependencies.store.revokeAuthSession(parsed.authSessionId);
      throw new AppError("Refresh token is invalid or was already used", 401, "invalid_refresh_token");
    }
    const device = await dependencies.store.getDevice(authSession.userId, authSession.deviceId);
    if (!device || device.trustState === "revoked") {
      await dependencies.store.revokeAuthSession(parsed.authSessionId);
      throw new AppError("Device access was revoked", 401, "revoked_device");
    }
    const accessToken = await dependencies.tokens.issueAccessToken({
      userId: authSession.userId,
      deviceId: authSession.deviceId,
      authSessionId: authSession.id,
      trusted: device.trustState === "trusted",
    });
    return {
      accessToken,
      refreshToken: next.token,
      tokenType: "Bearer",
      expiresIn: dependencies.accessTokenTTLSeconds,
      device: presentDevice(device),
    };
  });

  app.post("/v1/auth/logout", { preHandler: dependencies.authenticator.authenticate }, async (request, reply) => {
    await dependencies.store.revokeAuthSession(request.auth!.authSessionId);
    return reply.code(204).send();
  });

  app.get("/v1/me", { preHandler: dependencies.authenticator.authenticate }, async (request) => {
    const [user, device] = await Promise.all([
      dependencies.store.getUserById(request.auth!.userId),
      dependencies.store.getDevice(request.auth!.userId, request.auth!.deviceId),
    ]);
    if (!user || !device) throw new AppError("Account is unavailable", 404, "not_found");
    return { user: presentUser(user), device: presentDevice(device) };
  });
}
