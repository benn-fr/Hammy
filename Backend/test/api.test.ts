import { createPrivateKey, sign } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import {
  deviceApprovalPayload,
  deviceRevocationPayload,
  eventSignaturePayload,
  keyActivationPayload,
  loginProofPayload,
} from "../src/crypto/canonical.js";
import {
  createSessionKey,
  encryptEvent,
  encryptSessionMetadata,
  generateDeviceKeys,
  unwrapSessionKey,
  wrapSessionKey,
} from "../src/crypto/e2ee.js";
import { encodeBase64URL } from "../src/crypto/encoding.js";
import { MemoryStore } from "../src/db/memory-store.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  jwtSecret: "test-secret-that-is-longer-than-thirty-two-bytes",
  accessTokenTTLSeconds: 900,
  refreshTokenTTLDays: 30,
  corsOrigins: [],
  logLevel: "silent",
  inMemory: true,
  trustProxy: false,
};

type RegisteredAccount = {
  user: { id: string; email: string };
  device: { id: string; trustState: string; signingPublicKey: string; agreementPublicKey: string };
  tokens: { accessToken: string; refreshToken: string };
};

const apps: Array<Awaited<ReturnType<typeof buildApp>>["app"]> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const store = new MemoryStore();
  const built = await buildApp({ config, store });
  apps.push(built.app);
  return { ...built, store };
}

async function register(app: Awaited<ReturnType<typeof buildApp>>["app"], email: string, keys = generateDeviceKeys()) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      email,
      password: "correct horse battery staple",
      displayName: email.split("@")[0],
      device: {
        name: "Primary iPhone",
        platform: "ios",
        agreementPublicKey: keys.agreementPublicKey,
        signingPublicKey: keys.signingPublicKey,
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return { account: response.json<RegisteredAccount>(), keys };
}

function authorization(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

function expectError(response: LightMyRequestResponse, statusCode: number, code: string) {
  expect(response.statusCode).toBe(statusCode);
  expect(response.json().error.code).toBe(code);
}

describe("multi-user encrypted relay API", () => {
  it("requires a one-use signing-key challenge for an existing device login", async () => {
    const { app } = await makeApp();
    const owner = await register(app, "proof@example.com");
    const passwordOnly = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "proof@example.com",
        password: "correct horse battery staple",
        deviceId: owner.account.device.id,
      },
    });
    expectError(passwordOnly, 400, "invalid_request");

    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      payload: { email: "proof@example.com", deviceId: owner.account.device.id },
    });
    const challenge = challengeResponse.json<{ challengeId: string; challenge: string }>();
    const proofSignature = sign(null, loginProofPayload({
      userId: owner.account.user.id,
      deviceId: owner.account.device.id,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
    }), createPrivateKey(owner.keys.signingPrivateKeyPEM)).toString("base64url");
    const payload = {
      email: "proof@example.com",
      password: "correct horse battery staple",
      deviceId: owner.account.device.id,
      deviceProof: {
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
        signature: proofSignature,
      },
    };
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload });
    expect(login.statusCode).toBe(200);
    expect(login.json().device.trustState).toBe("trusted");

    const replay = await app.inject({ method: "POST", url: "/v1/auth/login", payload });
    expectError(replay, 401, "invalid_device_proof");
  });

  it("isolates sessions and ciphertext between accounts", async () => {
    const { app, store } = await makeApp();
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    const sessionId = crypto.randomUUID();
    const sessionKey = createSessionKey();
    const metadata = encryptSessionMetadata({
      plaintext: Buffer.from(JSON.stringify({ title: "Alice secret project" })),
      sessionKey,
      keyId: "session-key-v1",
      userId: alice.account.user.id,
      sessionId,
      senderDeviceId: alice.account.device.id,
      signingPrivateKeyPEM: alice.keys.signingPrivateKeyPEM,
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: authorization(alice.account.tokens.accessToken),
      payload: { id: sessionId, encryptedMetadata: metadata },
    });
    expect(created.statusCode).toBe(201);

    const messageId = crypto.randomUUID();
    const secret = "approval command: deploy the private project";
    const envelope = encryptEvent({
      plaintext: Buffer.from(secret),
      sessionKey,
      keyId: "session-key-v1",
      userId: alice.account.user.id,
      sessionId,
      messageId,
      senderDeviceId: alice.account.device.id,
      notificationHint: "attention",
      signingPrivateKeyPEM: alice.keys.signingPrivateKeyPEM,
    });
    const appended = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/events`,
      headers: authorization(alice.account.tokens.accessToken),
      payload: { messageId, notificationHint: "attention", envelope },
    });
    expect(appended.statusCode).toBe(201);

    const aliceList = await app.inject({ method: "GET", url: "/v1/sessions", headers: authorization(alice.account.tokens.accessToken) });
    const bobList = await app.inject({ method: "GET", url: "/v1/sessions", headers: authorization(bob.account.tokens.accessToken) });
    expect(aliceList.json().sessions).toHaveLength(1);
    expect(bobList.json().sessions).toHaveLength(0);

    const bobReadsAlice = await app.inject({
      method: "GET",
      url: `/v1/sessions/${sessionId}/events`,
      headers: authorization(bob.account.tokens.accessToken),
    });
    expectError(bobReadsAlice, 404, "not_found");

    const stored = await store.listEvents(alice.account.user.id, 0, 100);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify((await store.listRelaySessions(alice.account.user.id, false))[0])).not.toContain("Alice secret project");
  });

  it("requires a signed approval before a new device can read data", async () => {
    const { app } = await makeApp();
    const primary = await register(app, "pairing@example.com");
    const secondaryKeys = generateDeviceKeys();
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "pairing@example.com",
        password: "correct horse battery staple",
        newDevice: {
          name: "Mac bridge",
          platform: "bridge",
          agreementPublicKey: secondaryKeys.agreementPublicKey,
          signingPublicKey: secondaryKeys.signingPublicKey,
        },
      },
    });
    expect(login.statusCode).toBe(200);
    const pending = login.json<RegisteredAccount>();
    expect(pending.device.trustState).toBe("pending");
    const denied = await app.inject({ method: "GET", url: "/v1/sessions", headers: authorization(pending.tokens.accessToken) });
    expectError(denied, 403, "forbidden");

    const approvalPayload = deviceApprovalPayload({
      userId: primary.account.user.id,
      approverDeviceId: primary.account.device.id,
      pendingDeviceId: pending.device.id,
      pendingAgreementPublicKey: pending.device.agreementPublicKey,
      pendingSigningPublicKey: pending.device.signingPublicKey,
    });
    const signature = sign(null, approvalPayload, createPrivateKey(primary.keys.signingPrivateKeyPEM)).toString("base64url");
    const approval = await app.inject({
      method: "POST",
      url: `/v1/devices/${pending.device.id}/approve`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { signature },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json().needsKeyPackages).toBe(true);

    const nowAllowed = await app.inject({ method: "GET", url: "/v1/sessions", headers: authorization(pending.tokens.accessToken) });
    expect(nowAllowed.statusCode).toBe(200);
  });

  it("pairs an iPhone through a one-time companion code without transferring ChatGPT credentials", async () => {
    const { app } = await makeApp();
    const companion = await register(app, "companion-pair@example.com");
    const created = await app.inject({
      method: "POST", url: "/v1/pairings", headers: authorization(companion.account.tokens.accessToken), payload: {},
    });
    expect(created.statusCode).toBe(201);
    const pairing = created.json<{ pairingId: string; code: string }>();
    expect(pairing.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    const iphoneKeys = generateDeviceKeys();
    const claim = await app.inject({
      method: "POST", url: "/v1/pairings/claim", payload: {
        code: pairing.code,
        device: {
          name: "Ben’s iPhone", platform: "ios",
          agreementPublicKey: iphoneKeys.agreementPublicKey, signingPublicKey: iphoneKeys.signingPublicKey,
        },
      },
    });
    expect(claim.statusCode).toBe(200);

    const pending = await app.inject({
      method: "GET", url: `/v1/pairings/${pairing.pairingId}`, headers: authorization(companion.account.tokens.accessToken),
    });
    const device = pending.json<{ device: RegisteredAccount["device"] }>().device;
    expect(device.trustState).toBe("pending");
    const signature = sign(null, deviceApprovalPayload({
      userId: companion.account.user.id, approverDeviceId: companion.account.device.id,
      pendingDeviceId: device.id, pendingAgreementPublicKey: device.agreementPublicKey, pendingSigningPublicKey: device.signingPublicKey,
    }), createPrivateKey(companion.keys.signingPrivateKeyPEM)).toString("base64url");
    const approved = await app.inject({
      method: "POST", url: `/v1/devices/${device.id}/approve`, headers: authorization(companion.account.tokens.accessToken), payload: { signature },
    });
    expect(approved.statusCode).toBe(200);

    const complete = await app.inject({ method: "GET", url: `/v1/pairings/${pairing.pairingId}/complete?code=${pairing.code}` });
    expect(complete.statusCode).toBe(200);
    const iPhoneToken = complete.json<{ tokens: { accessToken: string } }>().tokens.accessToken;
    const usable = await app.inject({ method: "GET", url: "/v1/sessions", headers: authorization(iPhoneToken) });
    expect(usable.statusCode).toBe(200);
  });

  it("delivers a signed session-key package only to its intended device", async () => {
    const { app } = await makeApp();
    const primary = await register(app, "keys@example.com");
    const secondaryKeys = generateDeviceKeys();
    const pendingLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "keys@example.com",
        password: "correct horse battery staple",
        newDevice: {
          name: "Second device",
          platform: "macos",
          agreementPublicKey: secondaryKeys.agreementPublicKey,
          signingPublicKey: secondaryKeys.signingPublicKey,
        },
      },
    });
    const secondary = pendingLogin.json<RegisteredAccount>();
    const approvalPayload = deviceApprovalPayload({
      userId: primary.account.user.id,
      approverDeviceId: primary.account.device.id,
      pendingDeviceId: secondary.device.id,
      pendingAgreementPublicKey: secondary.device.agreementPublicKey,
      pendingSigningPublicKey: secondary.device.signingPublicKey,
    });
    const approvalSignature = sign(null, approvalPayload, createPrivateKey(primary.keys.signingPrivateKeyPEM)).toString("base64url");
    await app.inject({
      method: "POST",
      url: `/v1/devices/${secondary.device.id}/approve`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { signature: approvalSignature },
    });

    const sessionId = crypto.randomUUID();
    const sessionKey = createSessionKey();
    const metadata = encryptSessionMetadata({
      plaintext: Buffer.from("encrypted title"),
      sessionKey,
      keyId: "session-key-v1",
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      signingPrivateKeyPEM: primary.keys.signingPrivateKeyPEM,
    });
    await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: authorization(primary.account.tokens.accessToken),
      payload: { id: sessionId, encryptedMetadata: metadata },
    });
    const packageEnvelope = wrapSessionKey({
      sessionKey,
      keyId: "session-key-v1",
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      recipientDeviceId: secondary.device.id,
      recipientAgreementPublicKey: secondaryKeys.agreementPublicKey,
      signingPrivateKeyPEM: primary.keys.signingPrivateKeyPEM,
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: `/v1/sessions/${sessionId}/keys/${secondary.device.id}`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { envelope: packageEnvelope },
    });
    expect(uploaded.statusCode).toBe(200);

    const packages = await app.inject({ method: "GET", url: "/v1/key-packages", headers: authorization(secondary.tokens.accessToken) });
    expect(packages.statusCode).toBe(200);
    const delivered = packages.json().keyPackages[0].envelope;
    const recovered = unwrapSessionKey({
      envelope: delivered,
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      recipientDeviceId: secondary.device.id,
      senderSigningPublicKey: primary.keys.signingPublicKey,
      recipientAgreementPrivateKeyPEM: secondaryKeys.agreementPrivateKeyPEM,
    });
    expect(recovered).toEqual(sessionKey);
  });

  it("rejects ciphertext tampering and validly signed nonce reuse", async () => {
    const { app } = await makeApp();
    const owner = await register(app, "integrity@example.com");
    const sessionId = crypto.randomUUID();
    const sessionKey = createSessionKey();
    const metadata = encryptSessionMetadata({
      plaintext: Buffer.from("metadata"),
      sessionKey,
      keyId: "session-key-v1",
      userId: owner.account.user.id,
      sessionId,
      senderDeviceId: owner.account.device.id,
      signingPrivateKeyPEM: owner.keys.signingPrivateKeyPEM,
    });
    await app.inject({ method: "POST", url: "/v1/sessions", headers: authorization(owner.account.tokens.accessToken), payload: { id: sessionId, encryptedMetadata: metadata } });

    const messageId = crypto.randomUUID();
    const envelope = encryptEvent({
      plaintext: Buffer.from("first"),
      sessionKey,
      keyId: "session-key-v1",
      userId: owner.account.user.id,
      sessionId,
      messageId,
      senderDeviceId: owner.account.device.id,
      signingPrivateKeyPEM: owner.keys.signingPrivateKeyPEM,
    });
    const tamperedBytes = Buffer.from(envelope.ciphertext, "base64url");
    tamperedBytes[0] = tamperedBytes[0]! ^ 1;
    const tampered = { ...envelope, ciphertext: encodeBase64URL(tamperedBytes) };
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/events`,
      headers: authorization(owner.account.tokens.accessToken),
      payload: { messageId, notificationHint: "none", envelope: tampered },
    });
    expectError(rejected, 400, "invalid_signature");

    const first = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/events`,
      headers: authorization(owner.account.tokens.accessToken),
      payload: { messageId, notificationHint: "none", envelope },
    });
    expect(first.statusCode).toBe(201);

    const secondMessageId = crypto.randomUUID();
    const { signature: _oldSignature, ...unsigned } = envelope;
    const secondSignature = sign(null, eventSignaturePayload({
      userId: owner.account.user.id,
      sessionId,
      messageId: secondMessageId,
      senderDeviceId: owner.account.device.id,
      notificationHint: "none",
    }, unsigned), createPrivateKey(owner.keys.signingPrivateKeyPEM)).toString("base64url");
    const nonceReuse = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/events`,
      headers: authorization(owner.account.tokens.accessToken),
      payload: { messageId: secondMessageId, notificationHint: "none", envelope: { ...unsigned, signature: secondSignature } },
    });
    expectError(nonceReuse, 409, "nonce_reuse");
  });

  it("rotates refresh tokens and shuts down a replayed token family", async () => {
    const { app } = await makeApp();
    const owner = await register(app, "refresh@example.com");
    const firstRefresh = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: owner.account.tokens.refreshToken },
    });
    expect(firstRefresh.statusCode).toBe(200);
    const rotated = firstRefresh.json<{ accessToken: string; refreshToken: string }>();

    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: owner.account.tokens.refreshToken },
    });
    expectError(replay, 401, "invalid_refresh_token");

    const afterReplay = await app.inject({ method: "GET", url: "/v1/me", headers: authorization(rotated.accessToken) });
    expectError(afterReplay, 401, "unauthorized");
  });

  it("authenticates a WebSocket and delivers a live encrypted event", async () => {
    const { app } = await makeApp();
    const owner = await register(app, "socket@example.com");
    const sessionId = crypto.randomUUID();
    const sessionKey = createSessionKey();
    const metadata = encryptSessionMetadata({
      plaintext: Buffer.from("socket session"),
      sessionKey,
      keyId: "socket-session-key",
      userId: owner.account.user.id,
      sessionId,
      senderDeviceId: owner.account.device.id,
      signingPrivateKeyPEM: owner.keys.signingPrivateKeyPEM,
    });
    await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: authorization(owner.account.tokens.accessToken),
      payload: { id: sessionId, encryptedMetadata: metadata },
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socketURL = `${address.replace(/^http/, "ws")}/v1/events/live?after=0`;
    const messageId = crypto.randomUUID();
    const envelope = encryptEvent({
      plaintext: Buffer.from("live encrypted update"),
      sessionKey,
      keyId: "socket-session-key",
      userId: owner.account.user.id,
      sessionId,
      messageId,
      senderDeviceId: owner.account.device.id,
      signingPrivateKeyPEM: owner.keys.signingPrivateKeyPEM,
    });

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketURL, { headers: authorization(owner.account.tokens.accessToken) });
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error("Timed out waiting for live event"));
      }, 3_000);
      socket.on("error", reject);
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string; event?: { messageId: string } };
        if (frame.type === "ready") {
          void app.inject({
            method: "POST",
            url: `/v1/sessions/${sessionId}/events`,
            headers: authorization(owner.account.tokens.accessToken),
            payload: { messageId, notificationHint: "none", envelope },
          }).catch(reject);
        } else if (frame.type === "event" && frame.event?.messageId === messageId) {
          clearTimeout(timeout);
          socket.close();
          resolve();
        }
      });
    });
  });

  it("blocks future events after device revocation until every remaining device has a fresh key", async () => {
    const { app } = await makeApp();
    const primary = await register(app, "rotation@example.com");
    const secondaryKeys = generateDeviceKeys();
    const pendingLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "rotation@example.com",
        password: "correct horse battery staple",
        newDevice: {
          name: "Temporary Mac",
          platform: "macos",
          agreementPublicKey: secondaryKeys.agreementPublicKey,
          signingPublicKey: secondaryKeys.signingPublicKey,
        },
      },
    });
    const secondary = pendingLogin.json<RegisteredAccount>();
    const approvalSignature = sign(null, deviceApprovalPayload({
      userId: primary.account.user.id,
      approverDeviceId: primary.account.device.id,
      pendingDeviceId: secondary.device.id,
      pendingAgreementPublicKey: secondary.device.agreementPublicKey,
      pendingSigningPublicKey: secondary.device.signingPublicKey,
    }), createPrivateKey(primary.keys.signingPrivateKeyPEM)).toString("base64url");
    await app.inject({
      method: "POST",
      url: `/v1/devices/${secondary.device.id}/approve`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { signature: approvalSignature },
    });

    const sessionId = crypto.randomUUID();
    const oldKey = createSessionKey();
    const metadata = encryptSessionMetadata({
      plaintext: Buffer.from("rotation test"),
      sessionKey: oldKey,
      keyId: "old-session-key",
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      signingPrivateKeyPEM: primary.keys.signingPrivateKeyPEM,
    });
    await app.inject({ method: "POST", url: "/v1/sessions", headers: authorization(primary.account.tokens.accessToken), payload: { id: sessionId, encryptedMetadata: metadata } });

    const preSharedKeyId = "pre-shared-future-key";
    const preSharedPackage = wrapSessionKey({
      sessionKey: createSessionKey(),
      keyId: preSharedKeyId,
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      recipientDeviceId: primary.account.device.id,
      recipientAgreementPublicKey: primary.keys.agreementPublicKey,
      signingPrivateKeyPEM: primary.keys.signingPrivateKeyPEM,
    });
    const preSharedUpload = await app.inject({
      method: "PUT",
      url: `/v1/sessions/${sessionId}/keys/${primary.account.device.id}`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { envelope: preSharedPackage },
    });
    expect(preSharedUpload.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const revocationSignature = sign(null, deviceRevocationPayload({
      userId: primary.account.user.id,
      requestingDeviceId: primary.account.device.id,
      targetDeviceId: secondary.device.id,
    }), createPrivateKey(primary.keys.signingPrivateKeyPEM)).toString("base64url");
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/devices/${secondary.device.id}/revoke`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { signature: revocationSignature },
    });
    expect(revoked.statusCode).toBe(200);

    const blockedMessageId = crypto.randomUUID();
    const blockedEnvelope = encryptEvent({
      plaintext: Buffer.from("must not be accepted under the old key"),
      sessionKey: oldKey,
      keyId: "old-session-key",
      userId: primary.account.user.id,
      sessionId,
      messageId: blockedMessageId,
      senderDeviceId: primary.account.device.id,
      signingPrivateKeyPEM: primary.keys.signingPrivateKeyPEM,
    });
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/events`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { messageId: blockedMessageId, notificationHint: "none", envelope: blockedEnvelope },
    });
    expectError(blocked, 409, "key_rotation_required");

    const preSharedActivationSignature = sign(null, keyActivationPayload({
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      keyId: preSharedKeyId,
      keyEpoch: 2,
    }), createPrivateKey(primary.keys.signingPrivateKeyPEM)).toString("base64url");
    const preSharedActivation = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/keys/activate`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { keyId: preSharedKeyId, keyEpoch: 2, signature: preSharedActivationSignature },
    });
    expectError(preSharedActivation, 409, "conflict");

    const newKey = createSessionKey();
    const freshKeyId = "fresh-session-key";
    const selfPackage = wrapSessionKey({
      sessionKey: newKey,
      keyId: freshKeyId,
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      recipientDeviceId: primary.account.device.id,
      recipientAgreementPublicKey: primary.keys.agreementPublicKey,
      signingPrivateKeyPEM: primary.keys.signingPrivateKeyPEM,
    });
    const packageResponse = await app.inject({
      method: "PUT",
      url: `/v1/sessions/${sessionId}/keys/${primary.account.device.id}`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { envelope: selfPackage },
    });
    expect(packageResponse.statusCode).toBe(200);
    const activationSignature = sign(null, keyActivationPayload({
      userId: primary.account.user.id,
      sessionId,
      senderDeviceId: primary.account.device.id,
      keyId: freshKeyId,
      keyEpoch: 2,
    }), createPrivateKey(primary.keys.signingPrivateKeyPEM)).toString("base64url");
    const activated = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/keys/activate`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { keyId: freshKeyId, keyEpoch: 2, signature: activationSignature },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().session.keyRotationRequired).toBe(false);
    expect(activated.json().session.keyEpoch).toBe(2);
    const activationReplay = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/keys/activate`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { keyId: freshKeyId, keyEpoch: 2, signature: activationSignature },
    });
    expectError(activationReplay, 409, "conflict");

    const messageId = crypto.randomUUID();
    const envelope = encryptEvent({
      plaintext: Buffer.from("accepted after secure rotation"),
      sessionKey: newKey,
      keyId: freshKeyId,
      userId: primary.account.user.id,
      sessionId,
      messageId,
      senderDeviceId: primary.account.device.id,
      signingPrivateKeyPEM: primary.keys.signingPrivateKeyPEM,
    });
    const accepted = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/events`,
      headers: authorization(primary.account.tokens.accessToken),
      payload: { messageId, notificationHint: "none", envelope },
    });
    expect(accepted.statusCode).toBe(201);
  });
});
