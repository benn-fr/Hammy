import { z } from "zod";
import { decodeBase64URL } from "./crypto/encoding.js";

const canonicalBase64URL = z.string().regex(/^[A-Za-z0-9_-]+$/);

function encodedBytes(length: number) {
  return canonicalBase64URL.refine((value) => {
    try {
      decodeBase64URL(value, length);
      return true;
    } catch {
      return false;
    }
  }, `Must be canonical base64url encoding of ${length} bytes`);
}

const boundedCiphertext = canonicalBase64URL
  .min(22)
  .max(1_500_000)
  .refine((value) => {
    try {
      const size = decodeBase64URL(value).byteLength;
      return size >= 16 && size <= 1_048_592;
    } catch {
      return false;
    }
  }, "Ciphertext must contain 16 to 1,048,592 decoded bytes");

export const uuidSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const keyIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export const deviceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  platform: z.enum(["ios", "macos", "bridge"]),
  agreementPublicKey: encodedBytes(32),
  signingPublicKey: encodedBytes(32),
}).strict();

export const signedCiphertextSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("chacha20-poly1305"),
  keyId: keyIdSchema,
  nonce: encodedBytes(12),
  ciphertext: boundedCiphertext,
  clientCreatedAt: timestampSchema,
  signature: encodedBytes(64),
}).strict();

export const keyPackageEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("x25519-hkdf-sha256+chacha20-poly1305"),
  keyId: keyIdSchema,
  ephemeralPublicKey: encodedBytes(32),
  salt: encodedBytes(16),
  nonce: encodedBytes(12),
  ciphertext: encodedBytes(48),
  createdAt: timestampSchema,
  signature: encodedBytes(64),
}).strict();

export const registerSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
  displayName: z.string().trim().min(1).max(80),
  device: deviceInputSchema,
}).strict();

export const loginSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(256),
  deviceId: uuidSchema.optional(),
  newDevice: deviceInputSchema.optional(),
  deviceProof: z.object({
    challengeId: uuidSchema,
    challenge: encodedBytes(32),
    signature: encodedBytes(64),
  }).strict().optional(),
}).strict().refine((value) => Boolean(value.deviceId) !== Boolean(value.newDevice), {
  message: "Provide exactly one of deviceId or newDevice",
}).superRefine((value, context) => {
  if (value.deviceId && !value.deviceProof) {
    context.addIssue({ code: "custom", path: ["deviceProof"], message: "Existing devices must provide a signed login challenge" });
  }
  if (value.newDevice && value.deviceProof) {
    context.addIssue({ code: "custom", path: ["deviceProof"], message: "A pending new device must not provide an existing-device proof" });
  }
});

export const loginChallengeSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  deviceId: uuidSchema,
}).strict();

export const refreshSchema = z.object({
  refreshToken: z.string().min(40).max(300),
}).strict();

export const approvalSchema = z.object({
  signature: encodedBytes(64),
}).strict();

export const createSessionSchema = z.object({
  id: uuidSchema,
  encryptedMetadata: signedCiphertextSchema,
}).strict();

export const putKeyPackageSchema = z.object({
  envelope: keyPackageEnvelopeSchema,
}).strict();

export const activateKeySchema = z.object({
  keyId: keyIdSchema,
  keyEpoch: z.number().int().min(2).max(2_147_483_647),
  signature: encodedBytes(64),
}).strict();

export const appendEventSchema = z.object({
  messageId: uuidSchema,
  notificationHint: z.enum(["none", "generic", "attention"]).default("none"),
  envelope: signedCiphertextSchema,
}).strict();

export function assertClientTimestamp(value: string): void {
  const timestamp = new Date(value).getTime();
  const now = Date.now();
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - 30 * 24 * 60 * 60_000) {
    throw new Error("Client timestamp is outside the accepted window");
  }
}
