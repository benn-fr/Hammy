import type {
  AuthSessionRecord,
  DevicePlatform,
  DeviceRecord,
  EncryptedEventRecord,
  KeyPackageEnvelope,
  KeyPackageRecord,
  NotificationHint,
  PairingRecord,
  RelaySessionRecord,
  SignedCiphertext,
  UserRecord,
} from "../types.js";

export type DeviceInput = {
  name: string;
  platform: DevicePlatform;
  agreementPublicKey: string;
  signingPublicKey: string;
};

export interface Store {
  close(): Promise<void>;
  healthCheck(): Promise<void>;

  createAccount(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    device: DeviceInput;
  }): Promise<{ user: UserRecord; device: DeviceRecord }>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;

  createPendingDevice(userId: string, input: DeviceInput): Promise<DeviceRecord>;
  getDevice(userId: string, deviceId: string): Promise<DeviceRecord | null>;
  listDevices(userId: string): Promise<DeviceRecord[]>;
  approveDevice(userId: string, pendingDeviceId: string, approverDeviceId: string): Promise<DeviceRecord | null>;
  revokeDevice(userId: string, deviceId: string): Promise<DeviceRecord | null>;

  createAuthSession(input: {
    id: string;
    userId: string;
    deviceId: string;
    refreshTokenHash: string;
    expiresAt: string;
  }): Promise<AuthSessionRecord>;
  getAuthSession(authSessionId: string): Promise<AuthSessionRecord | null>;
  rotateAuthSession(input: {
    authSessionId: string;
    presentedHash: string;
    nextHash: string;
    nextExpiresAt: string;
  }): Promise<AuthSessionRecord | null>;
  revokeAuthSession(authSessionId: string): Promise<void>;

  createLoginChallenge(input: {
    id: string;
    userId: string;
    deviceId: string;
    challengeHash: string;
    expiresAt: string;
  }): Promise<void>;
  consumeLoginChallenge(input: {
    id: string;
    userId: string;
    deviceId: string;
    challengeHash: string;
  }): Promise<boolean>;

  createPairing(input: {
    id: string;
    userId: string;
    creatorDeviceId: string;
    codeHash: string;
    expiresAt: string;
  }): Promise<PairingRecord>;
  claimPairing(codeHash: string, device: DeviceInput): Promise<PairingRecord | null>;
  getPairing(userId: string, pairingId: string): Promise<PairingRecord | null>;
  getPairingByCode(pairingId: string, codeHash: string): Promise<PairingRecord | null>;
  consumePairing(pairingId: string, codeHash: string): Promise<PairingRecord | null>;

  createRelaySession(input: {
    id: string;
    userId: string;
    senderDeviceId: string;
    encryptedMetadata: SignedCiphertext;
  }): Promise<RelaySessionRecord>;
  getRelaySession(userId: string, sessionId: string): Promise<RelaySessionRecord | null>;
  listRelaySessions(userId: string, includeArchived: boolean): Promise<RelaySessionRecord[]>;
  archiveRelaySession(userId: string, sessionId: string): Promise<RelaySessionRecord | null>;
  activateSessionKey(userId: string, sessionId: string, keyId: string, keyEpoch: number): Promise<RelaySessionRecord | null>;

  putKeyPackage(input: {
    userId: string;
    sessionId: string;
    senderDeviceId: string;
    recipientDeviceId: string;
    envelope: KeyPackageEnvelope;
  }): Promise<KeyPackageRecord>;
  listKeyPackages(userId: string, recipientDeviceId: string): Promise<KeyPackageRecord[]>;

  appendEvent(input: {
    messageId: string;
    userId: string;
    sessionId: string;
    senderDeviceId: string;
    notificationHint: NotificationHint;
    envelope: SignedCiphertext;
  }): Promise<{ event: EncryptedEventRecord; inserted: boolean }>;
  listEvents(userId: string, afterCursor: number, limit: number, sessionId?: string): Promise<EncryptedEventRecord[]>;
}

export class ConflictError extends Error {
  readonly code = "conflict";
}

export class NotFoundError extends Error {
  readonly code = "not_found";
}

export class NonceReuseError extends Error {
  readonly code = "nonce_reuse";
}

export class KeyRotationRequiredError extends Error {
  readonly code = "key_rotation_required";
}
