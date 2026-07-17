import type { FastifyInstance } from "fastify";
import type { Authenticator } from "../auth/authenticator.js";
import {
  eventSignaturePayload,
  keyActivationPayload,
  keyPackageSignaturePayload,
  sessionArchivePayload,
  sessionMetadataSignaturePayload,
} from "../crypto/canonical.js";
import { verifyEd25519 } from "../crypto/signatures.js";
import type { Store } from "../db/store.js";
import { AppError } from "../errors.js";
import type { RelayHub } from "../realtime/hub.js";
import {
  appendEventSchema,
  activateKeySchema,
  approvalSchema,
  assertClientTimestamp,
  createSessionSchema,
  putKeyPackageSchema,
  uuidSchema,
} from "../schemas.js";

export async function registerSessionRoutes(app: FastifyInstance, dependencies: {
  store: Store;
  authenticator: Authenticator;
  hub: RelayHub;
}): Promise<void> {
  app.get<{ Querystring: { includeArchived?: string } }>("/v1/sessions", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async (request) => {
    const includeArchived = request.query.includeArchived === "true";
    const sessions = await dependencies.store.listRelaySessions(request.auth!.userId, includeArchived);
    return { sessions };
  });

  app.post("/v1/sessions", { preHandler: dependencies.authenticator.requireTrusted }, async (request, reply) => {
    const input = createSessionSchema.parse(request.body);
    assertTimestamp(input.encryptedMetadata.clientCreatedAt);
    const signer = await currentSigner(dependencies.store, request.auth!.userId, request.auth!.deviceId);
    const { signature, ...unsigned } = input.encryptedMetadata;
    const signaturePayload = sessionMetadataSignaturePayload({
      userId: request.auth!.userId,
      sessionId: input.id,
      senderDeviceId: signer.id,
    }, unsigned);
    if (!verifyEd25519(signer.signingPublicKey, signaturePayload, signature)) {
      throw new AppError("Session metadata signature is invalid", 400, "invalid_signature");
    }
    const session = await dependencies.store.createRelaySession({
      id: input.id,
      userId: request.auth!.userId,
      senderDeviceId: signer.id,
      encryptedMetadata: input.encryptedMetadata,
    });
    return reply.code(201).send({ session });
  });

  app.post<{ Params: { sessionId: string } }>("/v1/sessions/:sessionId/archive", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async (request) => {
    const sessionId = uuidSchema.parse(request.params.sessionId);
    const input = approvalSchema.parse(request.body);
    const signer = await currentSigner(dependencies.store, request.auth!.userId, request.auth!.deviceId);
    const payload = sessionArchivePayload({
      userId: request.auth!.userId,
      sessionId,
      senderDeviceId: signer.id,
    });
    if (!verifyEd25519(signer.signingPublicKey, payload, input.signature)) {
      throw new AppError("Session archive signature is invalid", 400, "invalid_signature");
    }
    const session = await dependencies.store.archiveRelaySession(request.auth!.userId, sessionId);
    if (!session) throw new AppError("Session was not found", 404, "not_found");
    return { session };
  });

  app.put<{ Params: { sessionId: string; recipientDeviceId: string } }>(
    "/v1/sessions/:sessionId/keys/:recipientDeviceId",
    { preHandler: dependencies.authenticator.requireTrusted },
    async (request) => {
      const sessionId = uuidSchema.parse(request.params.sessionId);
      const recipientDeviceId = uuidSchema.parse(request.params.recipientDeviceId);
      const input = putKeyPackageSchema.parse(request.body);
      assertTimestamp(input.envelope.createdAt);
      const [session, signer, recipient] = await Promise.all([
        dependencies.store.getRelaySession(request.auth!.userId, sessionId),
        currentSigner(dependencies.store, request.auth!.userId, request.auth!.deviceId),
        dependencies.store.getDevice(request.auth!.userId, recipientDeviceId),
      ]);
      if (!session) throw new AppError("Session was not found", 404, "not_found");
      if (!recipient || recipient.trustState !== "trusted") throw new AppError("Recipient device is not trusted", 400, "invalid_recipient");
      const { signature, ...unsigned } = input.envelope;
      const payload = keyPackageSignaturePayload({
        userId: request.auth!.userId,
        sessionId,
        senderDeviceId: signer.id,
        recipientDeviceId,
      }, unsigned);
      if (!verifyEd25519(signer.signingPublicKey, payload, signature)) {
        throw new AppError("Key package signature is invalid", 400, "invalid_signature");
      }
      const keyPackage = await dependencies.store.putKeyPackage({
        userId: request.auth!.userId,
        sessionId,
        senderDeviceId: signer.id,
        recipientDeviceId,
        envelope: input.envelope,
      });
      return { keyPackage };
    },
  );

  app.get("/v1/key-packages", { preHandler: dependencies.authenticator.requireTrusted }, async (request) => {
    const keyPackages = await dependencies.store.listKeyPackages(request.auth!.userId, request.auth!.deviceId);
    return { keyPackages };
  });

  app.post<{ Params: { sessionId: string } }>("/v1/sessions/:sessionId/keys/activate", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async (request) => {
    const sessionId = uuidSchema.parse(request.params.sessionId);
    const input = activateKeySchema.parse(request.body);
    const signer = await currentSigner(dependencies.store, request.auth!.userId, request.auth!.deviceId);
    const payload = keyActivationPayload({
      userId: request.auth!.userId,
      sessionId,
      senderDeviceId: signer.id,
      keyId: input.keyId,
      keyEpoch: input.keyEpoch,
    });
    if (!verifyEd25519(signer.signingPublicKey, payload, input.signature)) {
      throw new AppError("Key activation signature is invalid", 400, "invalid_signature");
    }
    const session = await dependencies.store.activateSessionKey(request.auth!.userId, sessionId, input.keyId, input.keyEpoch);
    if (!session) throw new AppError("Session was not found", 404, "not_found");
    return { session };
  });

  app.get<{ Params: { sessionId: string }; Querystring: { after?: string; limit?: string } }>(
    "/v1/sessions/:sessionId/events",
    { preHandler: dependencies.authenticator.requireTrusted },
    async (request) => {
      const sessionId = uuidSchema.parse(request.params.sessionId);
      const session = await dependencies.store.getRelaySession(request.auth!.userId, sessionId);
      if (!session) throw new AppError("Session was not found", 404, "not_found");
      const { after, limit } = parsePagination(request.query);
      const page = await dependencies.store.listEvents(request.auth!.userId, after, limit + 1, sessionId);
      const hasMore = page.length > limit;
      const events = page.slice(0, limit);
      return { events, nextCursor: events.at(-1)?.cursor ?? after, hasMore };
    },
  );

  app.post<{ Params: { sessionId: string } }>("/v1/sessions/:sessionId/events", {
    preHandler: dependencies.authenticator.requireTrusted,
  }, async (request, reply) => {
    const sessionId = uuidSchema.parse(request.params.sessionId);
    const input = appendEventSchema.parse(request.body);
    assertTimestamp(input.envelope.clientCreatedAt);
    const [session, signer] = await Promise.all([
      dependencies.store.getRelaySession(request.auth!.userId, sessionId),
      currentSigner(dependencies.store, request.auth!.userId, request.auth!.deviceId),
    ]);
    if (!session) throw new AppError("Session was not found", 404, "not_found");
    const { signature, ...unsigned } = input.envelope;
    const payload = eventSignaturePayload({
      userId: request.auth!.userId,
      sessionId,
      messageId: input.messageId,
      senderDeviceId: signer.id,
      notificationHint: input.notificationHint,
    }, unsigned);
    if (!verifyEd25519(signer.signingPublicKey, payload, signature)) {
      throw new AppError("Event signature is invalid", 400, "invalid_signature");
    }
    const result = await dependencies.store.appendEvent({
      messageId: input.messageId,
      userId: request.auth!.userId,
      sessionId,
      senderDeviceId: signer.id,
      notificationHint: input.notificationHint,
      envelope: input.envelope,
    });
    if (result.inserted) dependencies.hub.publish(result.event);
    return reply.code(result.inserted ? 201 : 200).send({ event: result.event, inserted: result.inserted });
  });
}

async function currentSigner(store: Store, userId: string, deviceId: string) {
  const device = await store.getDevice(userId, deviceId);
  if (!device || device.trustState !== "trusted") throw new AppError("Signing device is not trusted", 403, "untrusted_device");
  return device;
}

function assertTimestamp(timestamp: string): void {
  try {
    assertClientTimestamp(timestamp);
  } catch {
    throw new AppError("Client timestamp is outside the accepted window", 400, "invalid_timestamp");
  }
}

function parsePagination(query: { after?: string; limit?: string }): { after: number; limit: number } {
  const after = query.after === undefined ? 0 : Number(query.after);
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError("Invalid event pagination", 400, "invalid_pagination");
  }
  return { after, limit };
}

export { parsePagination };
