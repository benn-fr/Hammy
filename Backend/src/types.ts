export type DeviceTrustState = "pending" | "trusted" | "revoked";
export type DevicePlatform = "ios" | "macos" | "bridge";
export type NotificationHint = "none" | "generic" | "attention";

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
};

export type DeviceRecord = {
  id: string;
  userId: string;
  name: string;
  platform: DevicePlatform;
  agreementPublicKey: string;
  signingPublicKey: string;
  trustState: DeviceTrustState;
  approvedByDeviceId: string | null;
  createdAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
};

export type AuthSessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  refreshTokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastRotatedAt: string;
  revokedAt: string | null;
};

export type LoginChallengeRecord = {
  id: string;
  userId: string;
  deviceId: string;
  challengeHash: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
};

export type SignedCiphertext = {
  version: 1;
  algorithm: "chacha20-poly1305";
  keyId: string;
  nonce: string;
  ciphertext: string;
  clientCreatedAt: string;
  signature: string;
};

export type RelaySessionRecord = {
  id: string;
  userId: string;
  senderDeviceId: string;
  encryptedMetadata: SignedCiphertext;
  activeKeyId: string;
  keyEpoch: number;
  keyRotationRequired: boolean;
  keyRotationRequiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type EncryptedEventRecord = {
  cursor: number;
  messageId: string;
  userId: string;
  sessionId: string;
  senderDeviceId: string;
  notificationHint: NotificationHint;
  envelope: SignedCiphertext;
  receivedAt: string;
};

export type KeyPackageEnvelope = {
  version: 1;
  algorithm: "x25519-hkdf-sha256+chacha20-poly1305";
  keyId: string;
  ephemeralPublicKey: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
  signature: string;
};

export type KeyPackageRecord = {
  id: string;
  userId: string;
  sessionId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  envelope: KeyPackageEnvelope;
  createdAt: string;
};

export type AccessClaims = {
  userId: string;
  deviceId: string;
  authSessionId: string;
  trusted: boolean;
};

export type PublicDevice = Omit<DeviceRecord, "userId">;
