import { randomUUID } from "node:crypto";
import type {
  AuthSessionRecord,
  DeviceRecord,
  EncryptedEventRecord,
  KeyPackageRecord,
  LoginChallengeRecord,
  PairingRecord,
  PairingLobbyRecord,
  RelaySessionRecord,
  UserRecord,
} from "../types.js";
import { constantTimeEqual } from "../crypto/encoding.js";
import { ConflictError, KeyRotationRequiredError, NonceReuseError, type DeviceInput, type Store } from "./store.js";

export class MemoryStore implements Store {
  private readonly users = new Map<string, UserRecord>();
  private readonly userByEmail = new Map<string, string>();
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly authSessions = new Map<string, AuthSessionRecord>();
  private readonly loginChallenges = new Map<string, LoginChallengeRecord>();
  private readonly pairings = new Map<string, PairingRecord>();
  private readonly pairingLobbies = new Map<string, PairingLobbyRecord>();
  private readonly relaySessions = new Map<string, RelaySessionRecord>();
  private readonly sessionKeyEpochs = new Map<string, Map<string, number>>();
  private readonly keyPackages = new Map<string, KeyPackageRecord>();
  private readonly events: EncryptedEventRecord[] = [];
  private nextCursor = 1;

  async close(): Promise<void> {}
  async healthCheck(): Promise<void> {}

  async createAccount(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    device: DeviceInput;
  }): Promise<{ user: UserRecord; device: DeviceRecord }> {
    const email = input.email.toLowerCase();
    if (this.userByEmail.has(email)) throw new ConflictError("An account already exists for this email");
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: randomUUID(),
      email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      createdAt: now,
    };
    const device: DeviceRecord = {
      id: randomUUID(),
      userId: user.id,
      ...input.device,
      trustState: "trusted",
      approvedByDeviceId: null,
      createdAt: now,
      approvedAt: now,
      revokedAt: null,
    };
    this.users.set(user.id, user);
    this.userByEmail.set(email, user.id);
    this.devices.set(device.id, device);
    return { user, device };
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.userByEmail.get(email.toLowerCase());
    return id ? (this.users.get(id) ?? null) : null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async createPendingDevice(userId: string, input: DeviceInput): Promise<DeviceRecord> {
    const duplicate = [...this.devices.values()].find(
      (device) => device.userId === userId && (
        device.signingPublicKey === input.signingPublicKey || device.agreementPublicKey === input.agreementPublicKey
      ),
    );
    if (duplicate) throw new ConflictError("Device keys are already registered; use the existing-device challenge flow");
    const device: DeviceRecord = {
      id: randomUUID(),
      userId,
      ...input,
      trustState: "pending",
      approvedByDeviceId: null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      revokedAt: null,
    };
    this.devices.set(device.id, device);
    return device;
  }

  async getDevice(userId: string, deviceId: string): Promise<DeviceRecord | null> {
    const device = this.devices.get(deviceId);
    return device?.userId === userId ? device : null;
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    return [...this.devices.values()]
      .filter((device) => device.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async approveDevice(userId: string, pendingDeviceId: string, approverDeviceId: string): Promise<DeviceRecord | null> {
    const pending = await this.getDevice(userId, pendingDeviceId);
    const approver = await this.getDevice(userId, approverDeviceId);
    if (!pending || pending.trustState !== "pending" || !approver || approver.trustState !== "trusted") return null;
    const updated: DeviceRecord = {
      ...pending,
      trustState: "trusted",
      approvedByDeviceId: approverDeviceId,
      approvedAt: new Date().toISOString(),
    };
    this.devices.set(updated.id, updated);
    return updated;
  }

  async revokeDevice(userId: string, deviceId: string): Promise<DeviceRecord | null> {
    const device = await this.getDevice(userId, deviceId);
    if (!device || device.trustState === "revoked") return null;
    const trustedCount = [...this.devices.values()].filter(
      (candidate) => candidate.userId === userId && candidate.trustState === "trusted",
    ).length;
    if (device.trustState === "trusted" && trustedCount <= 1) {
      throw new ConflictError("The final trusted device cannot be revoked");
    }
    const now = new Date().toISOString();
    const updated: DeviceRecord = { ...device, trustState: "revoked", revokedAt: now };
    this.devices.set(device.id, updated);
    for (const session of this.authSessions.values()) {
      if (session.userId === userId && session.deviceId === deviceId && !session.revokedAt) {
        this.authSessions.set(session.id, { ...session, revokedAt: now });
      }
    }
    if (device.trustState === "trusted") {
      for (const relaySession of this.relaySessions.values()) {
        if (relaySession.userId === userId && !relaySession.archivedAt) {
          this.relaySessions.set(relaySession.id, {
            ...relaySession,
            keyRotationRequired: true,
            keyRotationRequiredAt: now,
          });
        }
      }
    }
    return updated;
  }

  async createAuthSession(input: {
    id: string;
    userId: string;
    deviceId: string;
    refreshTokenHash: string;
    expiresAt: string;
  }): Promise<AuthSessionRecord> {
    const now = new Date().toISOString();
    const record: AuthSessionRecord = {
      ...input,
      createdAt: now,
      lastRotatedAt: now,
      revokedAt: null,
    };
    this.authSessions.set(record.id, record);
    return record;
  }

  async getAuthSession(authSessionId: string): Promise<AuthSessionRecord | null> {
    return this.authSessions.get(authSessionId) ?? null;
  }

  async rotateAuthSession(input: {
    authSessionId: string;
    presentedHash: string;
    nextHash: string;
    nextExpiresAt: string;
  }): Promise<AuthSessionRecord | null> {
    const current = this.authSessions.get(input.authSessionId);
    if (!current || current.revokedAt || new Date(current.expiresAt) <= new Date() || !constantTimeEqual(current.refreshTokenHash, input.presentedHash)) {
      return null;
    }
    const updated: AuthSessionRecord = {
      ...current,
      refreshTokenHash: input.nextHash,
      expiresAt: input.nextExpiresAt,
      lastRotatedAt: new Date().toISOString(),
    };
    this.authSessions.set(updated.id, updated);
    return updated;
  }

  async revokeAuthSession(authSessionId: string): Promise<void> {
    const session = this.authSessions.get(authSessionId);
    if (session && !session.revokedAt) {
      this.authSessions.set(session.id, { ...session, revokedAt: new Date().toISOString() });
    }
  }

  async createLoginChallenge(input: {
    id: string;
    userId: string;
    deviceId: string;
    challengeHash: string;
    expiresAt: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    for (const [id, challenge] of this.loginChallenges) {
      if (new Date(challenge.expiresAt) <= new Date() || challenge.usedAt) this.loginChallenges.delete(id);
    }
    this.loginChallenges.set(input.id, { ...input, createdAt: now, usedAt: null });
  }

  async consumeLoginChallenge(input: {
    id: string;
    userId: string;
    deviceId: string;
    challengeHash: string;
  }): Promise<boolean> {
    const challenge = this.loginChallenges.get(input.id);
    if (
      !challenge || challenge.userId !== input.userId || challenge.deviceId !== input.deviceId ||
      challenge.usedAt || new Date(challenge.expiresAt) <= new Date() ||
      !constantTimeEqual(challenge.challengeHash, input.challengeHash)
    ) return false;
    this.loginChallenges.set(challenge.id, { ...challenge, usedAt: new Date().toISOString() });
    return true;
  }

  async createPairing(input: Omit<PairingRecord, "claimedDeviceId" | "claimedAt" | "consumedAt">): Promise<PairingRecord> {
    const record: PairingRecord = { ...input, claimedDeviceId: null, claimedAt: null, consumedAt: null };
    this.pairings.set(record.id, record);
    return record;
  }

  async claimPairing(codeHash: string, device: DeviceInput): Promise<PairingRecord | null> {
    const pairing = [...this.pairings.values()].find((candidate) =>
      candidate.codeHash === codeHash && !candidate.claimedDeviceId && !candidate.consumedAt && new Date(candidate.expiresAt) > new Date(),
    );
    if (!pairing) return null;
    const pending = await this.createPendingDevice(pairing.userId, device);
    const updated: PairingRecord = { ...pairing, claimedDeviceId: pending.id, claimedAt: new Date().toISOString() };
    this.pairings.set(updated.id, updated);
    return updated;
  }

  async getPairing(userId: string, pairingId: string): Promise<PairingRecord | null> {
    const pairing = this.pairings.get(pairingId);
    return pairing?.userId === userId ? pairing : null;
  }

  async getPairingByCode(pairingId: string, codeHash: string): Promise<PairingRecord | null> {
    const pairing = this.pairings.get(pairingId);
    if (!pairing || pairing.codeHash !== codeHash || pairing.consumedAt || new Date(pairing.expiresAt) <= new Date()) return null;
    return pairing;
  }

  async consumePairing(pairingId: string, codeHash: string): Promise<PairingRecord | null> {
    const pairing = await this.getPairingByCode(pairingId, codeHash);
    if (!pairing || !pairing.claimedDeviceId) return null;
    const device = await this.getDevice(pairing.userId, pairing.claimedDeviceId);
    if (!device || device.trustState !== "trusted") return null;
    const updated: PairingRecord = { ...pairing, consumedAt: new Date().toISOString() };
    this.pairings.set(updated.id, updated);
    return updated;
  }

  async createPairingLobby(input: {
    id: string;
    codeHash: string;
    device: DeviceInput;
    expiresAt: string;
  }): Promise<PairingLobbyRecord> {
    const now = new Date().toISOString();
    const lobby: PairingLobbyRecord = {
      id: input.id,
      codeHash: input.codeHash,
      deviceName: input.device.name,
      devicePlatform: input.device.platform,
      agreementPublicKey: input.device.agreementPublicKey,
      signingPublicKey: input.device.signingPublicKey,
      userId: null,
      creatorDeviceId: null,
      claimedDeviceId: null,
      expiresAt: input.expiresAt,
      claimedAt: null,
      consumedAt: null,
      createdAt: now,
    };
    this.pairingLobbies.set(lobby.id, lobby);
    return lobby;
  }

  async listOpenPairingLobbies(): Promise<Array<Pick<PairingLobbyRecord, "id" | "expiresAt" | "createdAt">>> {
    const now = new Date();
    return [...this.pairingLobbies.values()]
      .filter((lobby) => !lobby.claimedDeviceId && !lobby.consumedAt && new Date(lobby.expiresAt) > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ id, expiresAt, createdAt }) => ({ id, expiresAt, createdAt }));
  }

  async claimPairingLobby(input: {
    lobbyId: string;
    codeHash: string;
    userId: string;
    creatorDeviceId: string;
  }): Promise<PairingLobbyRecord | null> {
    const lobby = this.pairingLobbies.get(input.lobbyId);
    if (!lobby || lobby.codeHash !== input.codeHash || lobby.claimedDeviceId || lobby.consumedAt || new Date(lobby.expiresAt) <= new Date()) return null;
    const pending = await this.createPendingDevice(input.userId, {
      name: lobby.deviceName,
      platform: lobby.devicePlatform,
      agreementPublicKey: lobby.agreementPublicKey,
      signingPublicKey: lobby.signingPublicKey,
    });
    const updated: PairingLobbyRecord = {
      ...lobby,
      userId: input.userId,
      creatorDeviceId: input.creatorDeviceId,
      claimedDeviceId: pending.id,
      claimedAt: new Date().toISOString(),
    };
    this.pairingLobbies.set(updated.id, updated);
    return updated;
  }

  async getPairingLobby(userId: string, lobbyId: string): Promise<PairingLobbyRecord | null> {
    const lobby = this.pairingLobbies.get(lobbyId);
    return lobby?.userId === userId ? lobby : null;
  }

  async consumePairingLobby(lobbyId: string, codeHash: string): Promise<PairingLobbyRecord | null> {
    const lobby = this.pairingLobbies.get(lobbyId);
    if (!lobby || lobby.codeHash !== codeHash || !lobby.userId || !lobby.claimedDeviceId || lobby.consumedAt || new Date(lobby.expiresAt) <= new Date()) return null;
    const device = await this.getDevice(lobby.userId, lobby.claimedDeviceId);
    if (!device || device.trustState !== "trusted") return null;
    const updated: PairingLobbyRecord = { ...lobby, consumedAt: new Date().toISOString() };
    this.pairingLobbies.set(updated.id, updated);
    return updated;
  }

  async createRelaySession(input: Omit<RelaySessionRecord, "activeKeyId" | "keyRotationRequired" | "createdAt" | "updatedAt" | "archivedAt">): Promise<RelaySessionRecord> {
    if (this.relaySessions.has(input.id)) throw new ConflictError("Session already exists");
    const now = new Date().toISOString();
    const record: RelaySessionRecord = {
      ...input,
      activeKeyId: input.encryptedMetadata.keyId,
      keyEpoch: 1,
      keyRotationRequired: false,
      keyRotationRequiredAt: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.relaySessions.set(record.id, record);
    this.sessionKeyEpochs.set(record.id, new Map([[record.activeKeyId, 1]]));
    return record;
  }

  async getRelaySession(userId: string, sessionId: string): Promise<RelaySessionRecord | null> {
    const session = this.relaySessions.get(sessionId);
    return session?.userId === userId ? session : null;
  }

  async listRelaySessions(userId: string, includeArchived: boolean): Promise<RelaySessionRecord[]> {
    return [...this.relaySessions.values()]
      .filter((session) => session.userId === userId && (includeArchived || !session.archivedAt))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async archiveRelaySession(userId: string, sessionId: string): Promise<RelaySessionRecord | null> {
    const session = await this.getRelaySession(userId, sessionId);
    if (!session) return null;
    const now = new Date().toISOString();
    const updated: RelaySessionRecord = { ...session, archivedAt: now, updatedAt: now };
    this.relaySessions.set(session.id, updated);
    return updated;
  }

  async activateSessionKey(userId: string, sessionId: string, keyId: string, keyEpoch: number): Promise<RelaySessionRecord | null> {
    const session = await this.getRelaySession(userId, sessionId);
    if (!session) return null;
    const trustedDevices = [...this.devices.values()].filter(
      (device) => device.userId === userId && device.trustState === "trusted",
    );
    const recipients = new Set(
      [...this.keyPackages.values()]
        .filter((item) =>
          item.userId === userId && item.sessionId === sessionId && item.envelope.keyId === keyId &&
          (!session.keyRotationRequiredAt || item.createdAt >= session.keyRotationRequiredAt)
        )
        .map((item) => item.recipientDeviceId),
    );
    if (!trustedDevices.every((device) => recipients.has(device.id))) {
      throw new ConflictError("A key package is required for every trusted device before activation");
    }
    const history = this.sessionKeyEpochs.get(sessionId) ?? new Map<string, number>();
    if (keyEpoch !== session.keyEpoch + 1 || history.has(keyId)) {
      throw new ConflictError("Key epochs must increase by one and key IDs cannot be reused");
    }
    history.set(keyId, keyEpoch);
    this.sessionKeyEpochs.set(sessionId, history);
    const updated: RelaySessionRecord = {
      ...session,
      activeKeyId: keyId,
      keyEpoch,
      keyRotationRequired: false,
      keyRotationRequiredAt: null,
      updatedAt: new Date().toISOString(),
    };
    this.relaySessions.set(session.id, updated);
    return updated;
  }

  async putKeyPackage(input: Omit<KeyPackageRecord, "id" | "createdAt">): Promise<KeyPackageRecord> {
    const mapKey = `${input.sessionId}:${input.recipientDeviceId}:${input.envelope.keyId}`;
    const existing = this.keyPackages.get(mapKey);
    const record: KeyPackageRecord = {
      ...input,
      id: existing?.id ?? randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.keyPackages.set(mapKey, record);
    return record;
  }

  async listKeyPackages(userId: string, recipientDeviceId: string): Promise<KeyPackageRecord[]> {
    return [...this.keyPackages.values()]
      .filter((item) => item.userId === userId && item.recipientDeviceId === recipientDeviceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async appendEvent(input: Omit<EncryptedEventRecord, "cursor" | "receivedAt">): Promise<{ event: EncryptedEventRecord; inserted: boolean }> {
    const existing = this.events.find((event) => event.userId === input.userId && event.messageId === input.messageId);
    if (existing) {
      if (existing.sessionId !== input.sessionId) throw new ConflictError("Message ID is already bound to another session");
      return { event: existing, inserted: false };
    }
    const session = await this.getRelaySession(input.userId, input.sessionId);
    if (!session) throw new ConflictError("Session does not exist");
    if (session.keyRotationRequired || input.envelope.keyId !== session.activeKeyId) {
      throw new KeyRotationRequiredError("Activate a current session key before adding events");
    }
    if (
      session.encryptedMetadata.keyId === input.envelope.keyId &&
      session.encryptedMetadata.nonce === input.envelope.nonce
    ) {
      throw new NonceReuseError("A session metadata nonce cannot be reused by an event");
    }
    const reusedNonce = this.events.some(
      (event) => event.userId === input.userId && event.sessionId === input.sessionId && event.envelope.keyId === input.envelope.keyId && event.envelope.nonce === input.envelope.nonce,
    );
    if (reusedNonce) throw new NonceReuseError("A nonce cannot be reused with the same session key");
    const event: EncryptedEventRecord = {
      ...input,
      cursor: this.nextCursor++,
      receivedAt: new Date().toISOString(),
    };
    this.events.push(event);
    return { event, inserted: true };
  }

  async listEvents(userId: string, afterCursor: number, limit: number, sessionId?: string): Promise<EncryptedEventRecord[]> {
    return this.events
      .filter((event) => event.userId === userId && event.cursor > afterCursor && (!sessionId || event.sessionId === sessionId))
      .slice(0, limit);
  }
}
