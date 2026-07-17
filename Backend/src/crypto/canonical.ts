import type { KeyPackageEnvelope, NotificationHint, SignedCiphertext } from "../types.js";
import { canonicalFields } from "./encoding.js";

export type EventContext = {
  userId: string;
  sessionId: string;
  messageId: string;
  senderDeviceId: string;
  notificationHint: NotificationHint;
};

export type SessionMetadataContext = {
  userId: string;
  sessionId: string;
  senderDeviceId: string;
};

export type KeyPackageContext = {
  userId: string;
  sessionId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
};

export function eventAssociatedData(context: EventContext, envelope: Pick<SignedCiphertext, "version" | "algorithm" | "keyId" | "nonce" | "clientCreatedAt">): Buffer {
  return canonicalFields([
    "hammy.event.aad.v1",
    context.userId,
    context.sessionId,
    context.messageId,
    context.senderDeviceId,
    context.notificationHint,
    String(envelope.version),
    envelope.algorithm,
    envelope.keyId,
    envelope.nonce,
    envelope.clientCreatedAt,
  ]);
}

export function eventSignaturePayload(context: EventContext, envelope: Omit<SignedCiphertext, "signature">): Buffer {
  return canonicalFields([
    "hammy.event.signature.v1",
    context.userId,
    context.sessionId,
    context.messageId,
    context.senderDeviceId,
    context.notificationHint,
    String(envelope.version),
    envelope.algorithm,
    envelope.keyId,
    envelope.nonce,
    envelope.ciphertext,
    envelope.clientCreatedAt,
  ]);
}

export function sessionMetadataAssociatedData(context: SessionMetadataContext, envelope: Pick<SignedCiphertext, "version" | "algorithm" | "keyId" | "nonce" | "clientCreatedAt">): Buffer {
  return canonicalFields([
    "hammy.session-metadata.aad.v1",
    context.userId,
    context.sessionId,
    context.senderDeviceId,
    String(envelope.version),
    envelope.algorithm,
    envelope.keyId,
    envelope.nonce,
    envelope.clientCreatedAt,
  ]);
}

export function sessionMetadataSignaturePayload(context: SessionMetadataContext, envelope: Omit<SignedCiphertext, "signature">): Buffer {
  return canonicalFields([
    "hammy.session-metadata.signature.v1",
    context.userId,
    context.sessionId,
    context.senderDeviceId,
    String(envelope.version),
    envelope.algorithm,
    envelope.keyId,
    envelope.nonce,
    envelope.ciphertext,
    envelope.clientCreatedAt,
  ]);
}

export function keyPackageAssociatedData(context: KeyPackageContext, envelope: Pick<KeyPackageEnvelope, "version" | "algorithm" | "keyId" | "ephemeralPublicKey" | "salt" | "nonce" | "createdAt">): Buffer {
  return canonicalFields([
    "hammy.key-package.aad.v1",
    context.userId,
    context.sessionId,
    context.senderDeviceId,
    context.recipientDeviceId,
    String(envelope.version),
    envelope.algorithm,
    envelope.keyId,
    envelope.ephemeralPublicKey,
    envelope.salt,
    envelope.nonce,
    envelope.createdAt,
  ]);
}

export function keyPackageSignaturePayload(context: KeyPackageContext, envelope: Omit<KeyPackageEnvelope, "signature">): Buffer {
  return canonicalFields([
    "hammy.key-package.signature.v1",
    context.userId,
    context.sessionId,
    context.senderDeviceId,
    context.recipientDeviceId,
    String(envelope.version),
    envelope.algorithm,
    envelope.keyId,
    envelope.ephemeralPublicKey,
    envelope.salt,
    envelope.nonce,
    envelope.ciphertext,
    envelope.createdAt,
  ]);
}

export function keyPackageKDFInfo(context: KeyPackageContext, keyId: string): Buffer {
  return canonicalFields([
    "hammy.key-package.kdf.v1",
    context.userId,
    context.sessionId,
    context.senderDeviceId,
    context.recipientDeviceId,
    keyId,
  ]);
}

export function deviceApprovalPayload(input: {
  userId: string;
  approverDeviceId: string;
  pendingDeviceId: string;
  pendingAgreementPublicKey: string;
  pendingSigningPublicKey: string;
}): Buffer {
  return canonicalFields([
    "hammy.device-approval.signature.v1",
    input.userId,
    input.approverDeviceId,
    input.pendingDeviceId,
    input.pendingAgreementPublicKey,
    input.pendingSigningPublicKey,
  ]);
}

export function keyActivationPayload(input: {
  userId: string;
  sessionId: string;
  senderDeviceId: string;
  keyId: string;
  keyEpoch: number;
}): Buffer {
  return canonicalFields([
    "hammy.key-activation.signature.v1",
    input.userId,
    input.sessionId,
    input.senderDeviceId,
    input.keyId,
    String(input.keyEpoch),
  ]);
}

export function loginProofPayload(input: {
  userId: string;
  deviceId: string;
  challengeId: string;
  challenge: string;
}): Buffer {
  return canonicalFields([
    "hammy.login-proof.signature.v1",
    input.userId,
    input.deviceId,
    input.challengeId,
    input.challenge,
  ]);
}

export function deviceRevocationPayload(input: {
  userId: string;
  requestingDeviceId: string;
  targetDeviceId: string;
}): Buffer {
  return canonicalFields([
    "hammy.device-revocation.signature.v1",
    input.userId,
    input.requestingDeviceId,
    input.targetDeviceId,
  ]);
}

export function sessionArchivePayload(input: {
  userId: string;
  sessionId: string;
  senderDeviceId: string;
}): Buffer {
  return canonicalFields([
    "hammy.session-archive.signature.v1",
    input.userId,
    input.sessionId,
    input.senderDeviceId,
  ]);
}
