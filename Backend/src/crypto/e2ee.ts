import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";
import type { KeyPackageEnvelope, NotificationHint, SignedCiphertext } from "../types.js";
import {
  eventAssociatedData,
  eventSignaturePayload,
  keyPackageAssociatedData,
  keyPackageKDFInfo,
  keyPackageSignaturePayload,
  sessionMetadataAssociatedData,
  sessionMetadataSignaturePayload,
  type EventContext,
  type KeyPackageContext,
  type SessionMetadataContext,
} from "./canonical.js";
import { decodeBase64URL, encodeBase64URL } from "./encoding.js";
import { ed25519PublicKeyFromRaw, verifyEd25519 } from "./signatures.js";

export type DevicePrivateKeys = {
  agreementPrivateKeyPEM: string;
  signingPrivateKeyPEM: string;
  agreementPublicKey: string;
  signingPublicKey: string;
};

export function generateDeviceKeys(): DevicePrivateKeys {
  const agreement = generateKeyPairSync("x25519");
  const signing = generateKeyPairSync("ed25519");
  const agreementJWK = agreement.publicKey.export({ format: "jwk" });
  const signingJWK = signing.publicKey.export({ format: "jwk" });
  if (!agreementJWK.x || !signingJWK.x) {
    throw new Error("Runtime did not export raw public keys");
  }
  return {
    agreementPrivateKeyPEM: agreement.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    signingPrivateKeyPEM: signing.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    agreementPublicKey: agreementJWK.x,
    signingPublicKey: signingJWK.x,
  };
}

export function createSessionKey(): Buffer {
  return randomBytes(32);
}

export function encryptSessionMetadata(input: {
  plaintext: Uint8Array;
  sessionKey: Uint8Array;
  keyId: string;
  userId: string;
  sessionId: string;
  senderDeviceId: string;
  clientCreatedAt?: string;
  signingPrivateKeyPEM: string;
}): SignedCiphertext {
  const key = Buffer.from(input.sessionKey);
  if (key.byteLength !== 32) throw new Error("Session key must be 32 bytes");
  const nonce = randomBytes(12);
  const header = {
    version: 1 as const,
    algorithm: "chacha20-poly1305" as const,
    keyId: input.keyId,
    nonce: encodeBase64URL(nonce),
    clientCreatedAt: input.clientCreatedAt ?? new Date().toISOString(),
  };
  const context: SessionMetadataContext = {
    userId: input.userId,
    sessionId: input.sessionId,
    senderDeviceId: input.senderDeviceId,
  };
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  cipher.setAAD(sessionMetadataAssociatedData(context, header), { plaintextLength: input.plaintext.byteLength });
  const encrypted = Buffer.concat([cipher.update(input.plaintext), cipher.final(), cipher.getAuthTag()]);
  const unsigned = { ...header, ciphertext: encodeBase64URL(encrypted) };
  const signature = sign(null, sessionMetadataSignaturePayload(context, unsigned), createPrivateKey(input.signingPrivateKeyPEM));
  return { ...unsigned, signature: encodeBase64URL(signature) };
}

export function decryptSessionMetadata(input: {
  envelope: SignedCiphertext;
  sessionKey: Uint8Array;
  senderSigningPublicKey: string;
  userId: string;
  sessionId: string;
  senderDeviceId: string;
}): Buffer {
  const context: SessionMetadataContext = {
    userId: input.userId,
    sessionId: input.sessionId,
    senderDeviceId: input.senderDeviceId,
  };
  const { signature, ...unsigned } = input.envelope;
  if (!verifyEd25519(input.senderSigningPublicKey, sessionMetadataSignaturePayload(context, unsigned), signature)) {
    throw new Error("Session metadata signature is invalid");
  }
  const key = Buffer.from(input.sessionKey);
  if (key.byteLength !== 32) throw new Error("Session key must be 32 bytes");
  const nonce = decodeBase64URL(input.envelope.nonce, 12);
  const combined = decodeBase64URL(input.envelope.ciphertext);
  if (combined.byteLength < 16) throw new Error("Ciphertext is too short");
  const ciphertext = combined.subarray(0, combined.byteLength - 16);
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAAD(sessionMetadataAssociatedData(context, input.envelope), { plaintextLength: ciphertext.byteLength });
  decipher.setAuthTag(combined.subarray(combined.byteLength - 16));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptEvent(input: {
  plaintext: Uint8Array;
  sessionKey: Uint8Array;
  keyId: string;
  userId: string;
  sessionId: string;
  messageId: string;
  senderDeviceId: string;
  notificationHint?: NotificationHint;
  clientCreatedAt?: string;
  signingPrivateKeyPEM: string;
}): SignedCiphertext {
  const key = Buffer.from(input.sessionKey);
  if (key.byteLength !== 32) throw new Error("Session key must be 32 bytes");
  const nonce = randomBytes(12);
  const withoutCiphertext = {
    version: 1 as const,
    algorithm: "chacha20-poly1305" as const,
    keyId: input.keyId,
    nonce: encodeBase64URL(nonce),
    clientCreatedAt: input.clientCreatedAt ?? new Date().toISOString(),
  };
  const context: EventContext = {
    userId: input.userId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    senderDeviceId: input.senderDeviceId,
    notificationHint: input.notificationHint ?? "none",
  };
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  cipher.setAAD(eventAssociatedData(context, withoutCiphertext), { plaintextLength: input.plaintext.byteLength });
  const encrypted = Buffer.concat([cipher.update(input.plaintext), cipher.final(), cipher.getAuthTag()]);
  const unsigned = { ...withoutCiphertext, ciphertext: encodeBase64URL(encrypted) };
  const signature = sign(
    null,
    eventSignaturePayload(context, unsigned),
    createPrivateKey(input.signingPrivateKeyPEM),
  );
  return { ...unsigned, signature: encodeBase64URL(signature) };
}

export function decryptEvent(input: {
  envelope: SignedCiphertext;
  sessionKey: Uint8Array;
  senderSigningPublicKey: string;
  userId: string;
  sessionId: string;
  messageId: string;
  senderDeviceId: string;
  notificationHint?: NotificationHint;
}): Buffer {
  const context: EventContext = {
    userId: input.userId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    senderDeviceId: input.senderDeviceId,
    notificationHint: input.notificationHint ?? "none",
  };
  const { signature, ...unsigned } = input.envelope;
  if (!verifyEd25519(input.senderSigningPublicKey, eventSignaturePayload(context, unsigned), signature)) {
    throw new Error("Event signature is invalid");
  }

  const key = Buffer.from(input.sessionKey);
  if (key.byteLength !== 32) throw new Error("Session key must be 32 bytes");
  const nonce = decodeBase64URL(input.envelope.nonce, 12);
  const combined = decodeBase64URL(input.envelope.ciphertext);
  if (combined.byteLength < 16) throw new Error("Ciphertext is too short");
  const ciphertext = combined.subarray(0, combined.byteLength - 16);
  const tag = combined.subarray(combined.byteLength - 16);
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAAD(eventAssociatedData(context, input.envelope), { plaintextLength: ciphertext.byteLength });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function wrapSessionKey(input: {
  sessionKey: Uint8Array;
  keyId: string;
  userId: string;
  sessionId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  recipientAgreementPublicKey: string;
  signingPrivateKeyPEM: string;
  createdAt?: string;
}): KeyPackageEnvelope {
  const sessionKey = Buffer.from(input.sessionKey);
  if (sessionKey.byteLength !== 32) throw new Error("Session key must be 32 bytes");
  const context: KeyPackageContext = {
    userId: input.userId,
    sessionId: input.sessionId,
    senderDeviceId: input.senderDeviceId,
    recipientDeviceId: input.recipientDeviceId,
  };
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralJWK = ephemeral.publicKey.export({ format: "jwk" });
  if (!ephemeralJWK.x) throw new Error("Runtime did not export an ephemeral public key");
  const recipient = createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: decodeBase64URL(input.recipientAgreementPublicKey, 32).toString("base64url") },
    format: "jwk",
  });
  const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const wrappingKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, keyPackageKDFInfo(context, input.keyId), 32));
  const header = {
    version: 1 as const,
    algorithm: "x25519-hkdf-sha256+chacha20-poly1305" as const,
    keyId: input.keyId,
    ephemeralPublicKey: ephemeralJWK.x,
    salt: encodeBase64URL(salt),
    nonce: encodeBase64URL(nonce),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const cipher = createCipheriv("chacha20-poly1305", wrappingKey, nonce, { authTagLength: 16 });
  cipher.setAAD(keyPackageAssociatedData(context, header), { plaintextLength: sessionKey.byteLength });
  const encrypted = Buffer.concat([cipher.update(sessionKey), cipher.final(), cipher.getAuthTag()]);
  const unsigned = { ...header, ciphertext: encodeBase64URL(encrypted) };
  const signature = sign(null, keyPackageSignaturePayload(context, unsigned), createPrivateKey(input.signingPrivateKeyPEM));
  return { ...unsigned, signature: encodeBase64URL(signature) };
}

export function unwrapSessionKey(input: {
  envelope: KeyPackageEnvelope;
  userId: string;
  sessionId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  senderSigningPublicKey: string;
  recipientAgreementPrivateKeyPEM: string;
}): Buffer {
  const context: KeyPackageContext = {
    userId: input.userId,
    sessionId: input.sessionId,
    senderDeviceId: input.senderDeviceId,
    recipientDeviceId: input.recipientDeviceId,
  };
  const { signature, ...unsigned } = input.envelope;
  if (!verifyEd25519(input.senderSigningPublicKey, keyPackageSignaturePayload(context, unsigned), signature)) {
    throw new Error("Key package signature is invalid");
  }
  const ephemeral = createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: decodeBase64URL(input.envelope.ephemeralPublicKey, 32).toString("base64url") },
    format: "jwk",
  });
  const recipientPrivate = createPrivateKey(input.recipientAgreementPrivateKeyPEM);
  const sharedSecret = diffieHellman({ privateKey: recipientPrivate, publicKey: ephemeral });
  const salt = decodeBase64URL(input.envelope.salt, 16);
  const nonce = decodeBase64URL(input.envelope.nonce, 12);
  const wrappingKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, keyPackageKDFInfo(context, input.envelope.keyId), 32));
  const combined = decodeBase64URL(input.envelope.ciphertext);
  if (combined.byteLength !== 48) throw new Error("Wrapped session key has an invalid length");
  const decipher = createDecipheriv("chacha20-poly1305", wrappingKey, nonce, { authTagLength: 16 });
  decipher.setAAD(keyPackageAssociatedData(context, input.envelope), { plaintextLength: 32 });
  decipher.setAuthTag(combined.subarray(32));
  return Buffer.concat([decipher.update(combined.subarray(0, 32)), decipher.final()]);
}

export { ed25519PublicKeyFromRaw };
