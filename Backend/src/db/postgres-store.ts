import pg, { type PoolClient, type QueryResultRow } from "pg";
import type {
  AuthSessionRecord,
  DeviceRecord,
  EncryptedEventRecord,
  KeyPackageRecord,
  PairingRecord,
  PairingLobbyRecord,
  RelaySessionRecord,
  UserRecord,
} from "../types.js";
import { constantTimeEqual } from "../crypto/encoding.js";
import { ConflictError, KeyRotationRequiredError, NonceReuseError, type DeviceInput, type Store } from "./store.js";

const { Pool } = pg;

type Row = QueryResultRow & Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error("Database returned an invalid timestamp");
}

function mapUser(row: Row): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
    createdAt: iso(row.created_at),
  };
}

function mapDevice(row: Row): DeviceRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    platform: row.platform as DeviceRecord["platform"],
    agreementPublicKey: String(row.agreement_public_key),
    signingPublicKey: String(row.signing_public_key),
    trustState: row.trust_state as DeviceRecord["trustState"],
    approvedByDeviceId: row.approved_by_device_id ? String(row.approved_by_device_id) : null,
    createdAt: iso(row.created_at),
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
  };
}

function mapAuthSession(row: Row): AuthSessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: String(row.device_id),
    refreshTokenHash: String(row.refresh_token_hash),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    lastRotatedAt: iso(row.last_rotated_at),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
  };
}

function mapRelaySession(row: Row): RelaySessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    senderDeviceId: String(row.sender_device_id),
    encryptedMetadata: row.encrypted_metadata as RelaySessionRecord["encryptedMetadata"],
    activeKeyId: String(row.active_key_id),
    keyEpoch: Number(row.key_epoch),
    keyRotationRequired: Boolean(row.key_rotation_required),
    keyRotationRequiredAt: row.key_rotation_required_at ? iso(row.key_rotation_required_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
  };
}

function mapKeyPackage(row: Row): KeyPackageRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sessionId: String(row.session_id),
    senderDeviceId: String(row.sender_device_id),
    recipientDeviceId: String(row.recipient_device_id),
    envelope: row.envelope as KeyPackageRecord["envelope"],
    createdAt: iso(row.created_at),
  };
}

function mapEvent(row: Row): EncryptedEventRecord {
  return {
    cursor: Number(row.cursor),
    messageId: String(row.message_id),
    userId: String(row.user_id),
    sessionId: String(row.session_id),
    senderDeviceId: String(row.sender_device_id),
    notificationHint: row.notification_hint as EncryptedEventRecord["notificationHint"],
    envelope: row.envelope as EncryptedEventRecord["envelope"],
    receivedAt: iso(row.received_at),
  };
}

function mapPairing(row: Row): PairingRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    creatorDeviceId: String(row.creator_device_id),
    codeHash: String(row.code_hash),
    claimedDeviceId: row.claimed_device_id ? String(row.claimed_device_id) : null,
    expiresAt: iso(row.expires_at),
    claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
    consumedAt: row.consumed_at ? iso(row.consumed_at) : null,
  };
}

function mapPairingLobby(row: Row): PairingLobbyRecord {
  return {
    id: String(row.id),
    codeHash: String(row.code_hash),
    deviceName: String(row.device_name),
    devicePlatform: row.device_platform as PairingLobbyRecord["devicePlatform"],
    agreementPublicKey: String(row.agreement_public_key),
    signingPublicKey: String(row.signing_public_key),
    userId: row.user_id ? String(row.user_id) : null,
    creatorDeviceId: row.creator_device_id ? String(row.creator_device_id) : null,
    claimedDeviceId: row.claimed_device_id ? String(row.claimed_device_id) : null,
    expiresAt: iso(row.expires_at),
    claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
    consumedAt: row.consumed_at ? iso(row.consumed_at) : null,
    createdAt: iso(row.created_at),
  };
}

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(databaseURL: string) {
    this.pool = new Pool({
      connectionString: databaseURL,
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "hammy-backend",
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async withTenant<T>(userId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async withPairingCode<T>(codeHash: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('app.pairing_code_hash', $1, true)", [codeHash]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createAccount(input: { email: string; displayName: string; passwordHash: string; device: DeviceInput }): Promise<{ user: UserRecord; device: DeviceRecord }> {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    try {
      const userResult = await client.query<Row>(
        "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING *",
        [input.email.toLowerCase(), input.displayName, input.passwordHash],
      );
      const userRow = userResult.rows[0];
      if (!userRow) throw new Error("Failed to create account");
      const user = mapUser(userRow);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [user.id]);
      const deviceResult = await client.query<Row>(
        `INSERT INTO devices
          (user_id, name, platform, agreement_public_key, signing_public_key, trust_state, approved_at)
         VALUES ($1, $2, $3, $4, $5, 'trusted', now()) RETURNING *`,
        [user.id, input.device.name, input.device.platform, input.device.agreementPublicKey, input.device.signingPublicKey],
      );
      const deviceRow = deviceResult.rows[0];
      if (!deviceRow) throw new Error("Failed to create first device");
      await client.query("COMMIT");
      return { user, device: mapDevice(deviceRow) };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw new ConflictError("Account or device already exists");
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<Row>("SELECT * FROM users WHERE email = lower($1) LIMIT 1", [email]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    const result = await this.pool.query<Row>("SELECT * FROM users WHERE id = $1", [userId]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async createPendingDevice(userId: string, input: DeviceInput): Promise<DeviceRecord> {
    return this.withTenant(userId, async (client) => {
      const existing = await client.query<Row>(
        `SELECT * FROM devices
         WHERE user_id = $1 AND (signing_public_key = $2 OR agreement_public_key = $3) LIMIT 1`,
        [userId, input.signingPublicKey, input.agreementPublicKey],
      );
      if (existing.rows[0]) throw new ConflictError("Device keys are already registered; use the existing-device challenge flow");
      try {
        const result = await client.query<Row>(
          `INSERT INTO devices (user_id, name, platform, agreement_public_key, signing_public_key, trust_state)
           VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
          [userId, input.name, input.platform, input.agreementPublicKey, input.signingPublicKey],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Failed to create pending device");
        return mapDevice(row);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictError("Device keys are already registered");
        throw error;
      }
    });
  }

  async getDevice(userId: string, deviceId: string): Promise<DeviceRecord | null> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>("SELECT * FROM devices WHERE id = $1 AND user_id = $2", [deviceId, userId]);
      return result.rows[0] ? mapDevice(result.rows[0]) : null;
    });
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>("SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
      return result.rows.map(mapDevice);
    });
  }

  async approveDevice(userId: string, pendingDeviceId: string, approverDeviceId: string): Promise<DeviceRecord | null> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>(
        `UPDATE devices SET trust_state = 'trusted', approved_by_device_id = $3, approved_at = now()
         WHERE id = $2 AND user_id = $1 AND trust_state = 'pending'
           AND EXISTS (SELECT 1 FROM devices a WHERE a.id = $3 AND a.user_id = $1 AND a.trust_state = 'trusted')
         RETURNING *`,
        [userId, pendingDeviceId, approverDeviceId],
      );
      return result.rows[0] ? mapDevice(result.rows[0]) : null;
    });
  }

  async revokeDevice(userId: string, deviceId: string): Promise<DeviceRecord | null> {
    return this.withTenant(userId, async (client) => {
      const target = await client.query<Row>("SELECT * FROM devices WHERE id = $1 AND user_id = $2 FOR UPDATE", [deviceId, userId]);
      const row = target.rows[0];
      if (!row || row.trust_state === "revoked") return null;
      if (row.trust_state === "trusted") {
        const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM devices WHERE user_id = $1 AND trust_state = 'trusted'", [userId]);
        if (Number(count.rows[0]?.count ?? 0) <= 1) throw new ConflictError("The final trusted device cannot be revoked");
      }
      const updated = await client.query<Row>(
        "UPDATE devices SET trust_state = 'revoked', revoked_at = now() WHERE id = $1 AND user_id = $2 RETURNING *",
        [deviceId, userId],
      );
      await client.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND device_id = $2", [userId, deviceId]);
      if (row.trust_state === "trusted") {
        await client.query(
          `UPDATE relay_sessions
           SET key_rotation_required = true, key_rotation_required_at = now(), updated_at = now()
           WHERE user_id = $1 AND archived_at IS NULL`,
          [userId],
        );
      }
      return updated.rows[0] ? mapDevice(updated.rows[0]) : null;
    });
  }

  async createAuthSession(input: { id: string; userId: string; deviceId: string; refreshTokenHash: string; expiresAt: string }): Promise<AuthSessionRecord> {
    const result = await this.pool.query<Row>(
      `INSERT INTO auth_sessions (id, user_id, device_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.id, input.userId, input.deviceId, input.refreshTokenHash, input.expiresAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to create auth session");
    return mapAuthSession(row);
  }

  async getAuthSession(authSessionId: string): Promise<AuthSessionRecord | null> {
    const result = await this.pool.query<Row>("SELECT * FROM auth_sessions WHERE id = $1", [authSessionId]);
    return result.rows[0] ? mapAuthSession(result.rows[0]) : null;
  }

  async rotateAuthSession(input: { authSessionId: string; presentedHash: string; nextHash: string; nextExpiresAt: string }): Promise<AuthSessionRecord | null> {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    try {
      const selected = await client.query<Row>("SELECT * FROM auth_sessions WHERE id = $1 FOR UPDATE", [input.authSessionId]);
      const current = selected.rows[0] ? mapAuthSession(selected.rows[0]) : null;
      if (!current || current.revokedAt || new Date(current.expiresAt) <= new Date() || !constantTimeEqual(current.refreshTokenHash, input.presentedHash)) {
        await client.query("ROLLBACK");
        return null;
      }
      const result = await client.query<Row>(
        `UPDATE auth_sessions SET refresh_token_hash = $2, expires_at = $3, last_rotated_at = now()
         WHERE id = $1 RETURNING *`,
        [input.authSessionId, input.nextHash, input.nextExpiresAt],
      );
      await client.query("COMMIT");
      return result.rows[0] ? mapAuthSession(result.rows[0]) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAuthSession(authSessionId: string): Promise<void> {
    await this.pool.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1", [authSessionId]);
  }

  async createLoginChallenge(input: {
    id: string;
    userId: string;
    deviceId: string;
    challengeHash: string;
    expiresAt: string;
  }): Promise<void> {
    await this.pool.query("DELETE FROM login_challenges WHERE expires_at <= now() OR used_at IS NOT NULL");
    await this.pool.query(
      `INSERT INTO login_challenges (id, user_id, device_id, challenge_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.id, input.userId, input.deviceId, input.challengeHash, input.expiresAt],
    );
  }

  async consumeLoginChallenge(input: {
    id: string;
    userId: string;
    deviceId: string;
    challengeHash: string;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    try {
      const selected = await client.query<Row>(
        `SELECT * FROM login_challenges
         WHERE id = $1 AND user_id = $2 AND device_id = $3 FOR UPDATE`,
        [input.id, input.userId, input.deviceId],
      );
      const row = selected.rows[0];
      if (
        !row || row.used_at || new Date(String(row.expires_at)) <= new Date() ||
        !constantTimeEqual(String(row.challenge_hash), input.challengeHash)
      ) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("UPDATE login_challenges SET used_at = now() WHERE id = $1", [input.id]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createPairing(input: Omit<PairingRecord, "claimedDeviceId" | "claimedAt" | "consumedAt">): Promise<PairingRecord> {
    return this.withTenant(input.userId, async (client) => {
      const result = await client.query<Row>(
        `INSERT INTO pairings (id, user_id, creator_device_id, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.id, input.userId, input.creatorDeviceId, input.codeHash, input.expiresAt],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Failed to create pairing");
      return mapPairing(row);
    });
  }

  async claimPairing(codeHash: string, device: DeviceInput): Promise<PairingRecord | null> {
    return this.withPairingCode(codeHash, async (client) => {
      const selected = await client.query<Row>(
        `SELECT * FROM pairings
         WHERE code_hash = $1 AND claimed_device_id IS NULL AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [codeHash],
      );
      const pairingRow = selected.rows[0];
      if (!pairingRow) return null;
      const pairing = mapPairing(pairingRow);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [pairing.userId]);
      const duplicate = await client.query<Row>(
        `SELECT id FROM devices WHERE user_id = $1 AND (signing_public_key = $2 OR agreement_public_key = $3) LIMIT 1`,
        [pairing.userId, device.signingPublicKey, device.agreementPublicKey],
      );
      if (duplicate.rows[0]) throw new ConflictError("Device keys are already registered");
      const created = await client.query<Row>(
        `INSERT INTO devices (user_id, name, platform, agreement_public_key, signing_public_key, trust_state)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
        [pairing.userId, device.name, device.platform, device.agreementPublicKey, device.signingPublicKey],
      );
      const pending = created.rows[0];
      if (!pending) throw new Error("Failed to create paired device");
      const updated = await client.query<Row>(
        "UPDATE pairings SET claimed_device_id = $2, claimed_at = now() WHERE id = $1 RETURNING *",
        [pairing.id, pending.id],
      );
      return updated.rows[0] ? mapPairing(updated.rows[0]) : null;
    });
  }

  async getPairing(userId: string, pairingId: string): Promise<PairingRecord | null> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>("SELECT * FROM pairings WHERE id = $1 AND user_id = $2", [pairingId, userId]);
      return result.rows[0] ? mapPairing(result.rows[0]) : null;
    });
  }

  async getPairingByCode(pairingId: string, codeHash: string): Promise<PairingRecord | null> {
    return this.withPairingCode(codeHash, async (client) => {
      const result = await client.query<Row>(
        "SELECT * FROM pairings WHERE id = $1 AND code_hash = $2 AND consumed_at IS NULL AND expires_at > now()",
        [pairingId, codeHash],
      );
      return result.rows[0] ? mapPairing(result.rows[0]) : null;
    });
  }

  async consumePairing(pairingId: string, codeHash: string): Promise<PairingRecord | null> {
    return this.withPairingCode(codeHash, async (client) => {
      const selected = await client.query<Row>(
        `SELECT * FROM pairings WHERE id = $1 AND code_hash = $2 AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [pairingId, codeHash],
      );
      const row = selected.rows[0];
      if (!row) return null;
      const pairing = mapPairing(row);
      if (!pairing.claimedDeviceId) return null;
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [pairing.userId]);
      const device = await client.query<Row>("SELECT trust_state FROM devices WHERE id = $1 AND user_id = $2", [pairing.claimedDeviceId, pairing.userId]);
      if (device.rows[0]?.trust_state !== "trusted") return null;
      const updated = await client.query<Row>("UPDATE pairings SET consumed_at = now() WHERE id = $1 RETURNING *", [pairing.id]);
      return updated.rows[0] ? mapPairing(updated.rows[0]) : null;
    });
  }

  async createPairingLobby(input: {
    id: string;
    codeHash: string;
    device: DeviceInput;
    expiresAt: string;
  }): Promise<PairingLobbyRecord> {
    return this.withPairingCode(input.codeHash, async (client) => {
      const result = await client.query<Row>(
        `INSERT INTO pairing_lobbies (id, code_hash, device_name, device_platform, agreement_public_key, signing_public_key, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [input.id, input.codeHash, input.device.name, input.device.platform, input.device.agreementPublicKey, input.device.signingPublicKey, input.expiresAt],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Failed to create pairing lobby");
      return mapPairingLobby(row);
    });
  }

  async listOpenPairingLobbies(): Promise<Array<Pick<PairingLobbyRecord, "id" | "expiresAt" | "createdAt">>> {
    const result = await this.pool.query<Row>(
      `SELECT id, expires_at, created_at FROM pairing_lobbies
       WHERE claimed_device_id IS NULL AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 20`,
    );
    return result.rows.map((row) => ({ id: String(row.id), expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) }));
  }

  async claimPairingLobby(input: {
    lobbyId: string;
    codeHash: string;
    userId: string;
    creatorDeviceId: string;
  }): Promise<PairingLobbyRecord | null> {
    return this.withPairingCode(input.codeHash, async (client) => {
      const selected = await client.query<Row>(
        `SELECT * FROM pairing_lobbies
         WHERE id = $1 AND code_hash = $2 AND claimed_device_id IS NULL AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [input.lobbyId, input.codeHash],
      );
      const row = selected.rows[0];
      if (!row) return null;
      const lobby = mapPairingLobby(row);
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [input.userId]);
      const duplicate = await client.query<Row>(
        `SELECT id FROM devices WHERE user_id = $1 AND (signing_public_key = $2 OR agreement_public_key = $3) LIMIT 1`,
        [input.userId, lobby.signingPublicKey, lobby.agreementPublicKey],
      );
      if (duplicate.rows[0]) throw new ConflictError("Device keys are already registered");
      const created = await client.query<Row>(
        `INSERT INTO devices (user_id, name, platform, agreement_public_key, signing_public_key, trust_state)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
        [input.userId, lobby.deviceName, lobby.devicePlatform, lobby.agreementPublicKey, lobby.signingPublicKey],
      );
      const pending = created.rows[0];
      if (!pending) throw new Error("Failed to create paired device");
      const updated = await client.query<Row>(
        `UPDATE pairing_lobbies SET user_id = $2, creator_device_id = $3, claimed_device_id = $4, claimed_at = now()
         WHERE id = $1 RETURNING *`,
        [input.lobbyId, input.userId, input.creatorDeviceId, pending.id],
      );
      return updated.rows[0] ? mapPairingLobby(updated.rows[0]) : null;
    });
  }

  async getPairingLobby(userId: string, lobbyId: string): Promise<PairingLobbyRecord | null> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>("SELECT * FROM pairing_lobbies WHERE id = $1 AND user_id = $2", [lobbyId, userId]);
      return result.rows[0] ? mapPairingLobby(result.rows[0]) : null;
    });
  }

  async consumePairingLobby(lobbyId: string, codeHash: string): Promise<PairingLobbyRecord | null> {
    return this.withPairingCode(codeHash, async (client) => {
      const selected = await client.query<Row>(
        `SELECT * FROM pairing_lobbies
         WHERE id = $1 AND code_hash = $2 AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [lobbyId, codeHash],
      );
      const row = selected.rows[0];
      if (!row) return null;
      const lobby = mapPairingLobby(row);
      if (!lobby.userId || !lobby.claimedDeviceId) return null;
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [lobby.userId]);
      const device = await client.query<Row>("SELECT trust_state FROM devices WHERE id = $1 AND user_id = $2", [lobby.claimedDeviceId, lobby.userId]);
      if (device.rows[0]?.trust_state !== "trusted") return null;
      const updated = await client.query<Row>("UPDATE pairing_lobbies SET consumed_at = now() WHERE id = $1 RETURNING *", [lobby.id]);
      return updated.rows[0] ? mapPairingLobby(updated.rows[0]) : null;
    });
  }

  async createRelaySession(input: Omit<RelaySessionRecord, "createdAt" | "updatedAt" | "archivedAt">): Promise<RelaySessionRecord> {
    return this.withTenant(input.userId, async (client) => {
      try {
        const result = await client.query<Row>(
          `INSERT INTO relay_sessions (id, user_id, sender_device_id, encrypted_metadata, active_key_id)
           VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *`,
          [input.id, input.userId, input.senderDeviceId, JSON.stringify(input.encryptedMetadata), input.encryptedMetadata.keyId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Failed to create relay session");
        await client.query(
          "INSERT INTO session_key_epochs (session_id, user_id, key_id, key_epoch) VALUES ($1, $2, $3, 1)",
          [input.id, input.userId, input.encryptedMetadata.keyId],
        );
        return mapRelaySession(row);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictError("Session already exists");
        throw error;
      }
    });
  }

  async getRelaySession(userId: string, sessionId: string): Promise<RelaySessionRecord | null> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>("SELECT * FROM relay_sessions WHERE id = $1 AND user_id = $2", [sessionId, userId]);
      return result.rows[0] ? mapRelaySession(result.rows[0]) : null;
    });
  }

  async listRelaySessions(userId: string, includeArchived: boolean): Promise<RelaySessionRecord[]> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>(
        `SELECT * FROM relay_sessions WHERE user_id = $1 AND ($2::boolean OR archived_at IS NULL) ORDER BY updated_at DESC`,
        [userId, includeArchived],
      );
      return result.rows.map(mapRelaySession);
    });
  }

  async archiveRelaySession(userId: string, sessionId: string): Promise<RelaySessionRecord | null> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>(
        "UPDATE relay_sessions SET archived_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *",
        [sessionId, userId],
      );
      return result.rows[0] ? mapRelaySession(result.rows[0]) : null;
    });
  }

  async activateSessionKey(userId: string, sessionId: string, keyId: string, keyEpoch: number): Promise<RelaySessionRecord | null> {
    return this.withTenant(userId, async (client) => {
      const session = await client.query<Row>("SELECT * FROM relay_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE", [sessionId, userId]);
      const sessionRow = session.rows[0];
      if (!sessionRow) return null;
      if (keyEpoch !== Number(sessionRow.key_epoch) + 1) {
        throw new ConflictError("Key epochs must increase by one");
      }
      const missing = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM devices d
         WHERE d.user_id = $1 AND d.trust_state = 'trusted'
           AND NOT EXISTS (
             SELECT 1 FROM key_packages k
             WHERE k.user_id = $1 AND k.session_id = $2 AND k.recipient_device_id = d.id AND k.key_id = $3
               AND ($4::timestamptz IS NULL OR k.created_at >= $4::timestamptz)
           )`,
        [userId, sessionId, keyId, sessionRow.key_rotation_required_at ?? null],
      );
      if (Number(missing.rows[0]?.count ?? 0) > 0) {
        throw new ConflictError("A key package is required for every trusted device before activation");
      }
      try {
        await client.query(
          "INSERT INTO session_key_epochs (session_id, user_id, key_id, key_epoch) VALUES ($1, $2, $3, $4)",
          [sessionId, userId, keyId, keyEpoch],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError("A session key ID or epoch cannot be reused");
        }
        throw error;
      }
      const result = await client.query<Row>(
        `UPDATE relay_sessions
         SET active_key_id = $3, key_epoch = $4, key_rotation_required = false,
             key_rotation_required_at = NULL, updated_at = now()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [sessionId, userId, keyId, keyEpoch],
      );
      return result.rows[0] ? mapRelaySession(result.rows[0]) : null;
    });
  }

  async putKeyPackage(input: Omit<KeyPackageRecord, "id" | "createdAt">): Promise<KeyPackageRecord> {
    return this.withTenant(input.userId, async (client) => {
      const result = await client.query<Row>(
        `INSERT INTO key_packages
          (user_id, session_id, sender_device_id, recipient_device_id, key_id, envelope)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (session_id, recipient_device_id, key_id)
         DO UPDATE SET sender_device_id = EXCLUDED.sender_device_id, envelope = EXCLUDED.envelope, created_at = now()
         RETURNING *`,
        [input.userId, input.sessionId, input.senderDeviceId, input.recipientDeviceId, input.envelope.keyId, JSON.stringify(input.envelope)],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Failed to store key package");
      return mapKeyPackage(row);
    });
  }

  async listKeyPackages(userId: string, recipientDeviceId: string): Promise<KeyPackageRecord[]> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>(
        "SELECT * FROM key_packages WHERE user_id = $1 AND recipient_device_id = $2 ORDER BY created_at",
        [userId, recipientDeviceId],
      );
      return result.rows.map(mapKeyPackage);
    });
  }

  async appendEvent(input: Omit<EncryptedEventRecord, "cursor" | "receivedAt">): Promise<{ event: EncryptedEventRecord; inserted: boolean }> {
    return this.withTenant(input.userId, async (client) => {
      const idempotent = await client.query<Row>(
        "SELECT * FROM encrypted_events WHERE user_id = $1 AND message_id = $2",
        [input.userId, input.messageId],
      );
      if (idempotent.rows[0]) {
        const existing = mapEvent(idempotent.rows[0]);
        if (existing.sessionId !== input.sessionId) throw new ConflictError("Message ID is already bound to another session");
        return { event: existing, inserted: false };
      }
      const session = await client.query<Row>(
        "SELECT active_key_id, key_rotation_required, encrypted_metadata FROM relay_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [input.sessionId, input.userId],
      );
      const sessionRow = session.rows[0];
      if (!sessionRow) throw new ConflictError("Session does not exist");
      if (Boolean(sessionRow.key_rotation_required) || String(sessionRow.active_key_id) !== input.envelope.keyId) {
        throw new KeyRotationRequiredError("Activate a current session key before adding events");
      }
      const encryptedMetadata = sessionRow.encrypted_metadata as RelaySessionRecord["encryptedMetadata"];
      if (encryptedMetadata.keyId === input.envelope.keyId && encryptedMetadata.nonce === input.envelope.nonce) {
        throw new NonceReuseError("A session metadata nonce cannot be reused by an event");
      }
      try {
        const result = await client.query<Row>(
          `INSERT INTO encrypted_events
            (message_id, user_id, session_id, sender_device_id, notification_hint, key_id, nonce, envelope)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *`,
          [input.messageId, input.userId, input.sessionId, input.senderDeviceId, input.notificationHint, input.envelope.keyId, input.envelope.nonce, JSON.stringify(input.envelope)],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Failed to append event");
        await client.query("UPDATE relay_sessions SET updated_at = now() WHERE id = $1 AND user_id = $2", [input.sessionId, input.userId]);
        return { event: mapEvent(row), inserted: true };
      } catch (error) {
        const databaseError = error as { code?: string; constraint?: string };
        if (databaseError.code === "23505" && databaseError.constraint === "encrypted_events_user_message_key") {
          const existing = await client.query<Row>("SELECT * FROM encrypted_events WHERE user_id = $1 AND message_id = $2", [input.userId, input.messageId]);
          const row = existing.rows[0];
          if (!row) throw error;
          return { event: mapEvent(row), inserted: false };
        }
        if (databaseError.code === "23505" && databaseError.constraint === "encrypted_events_session_nonce_key") {
          throw new NonceReuseError("A nonce cannot be reused with the same session key");
        }
        throw error;
      }
    });
  }

  async listEvents(userId: string, afterCursor: number, limit: number, sessionId?: string): Promise<EncryptedEventRecord[]> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<Row>(
        `SELECT * FROM encrypted_events
         WHERE user_id = $1 AND cursor > $2 AND ($3::uuid IS NULL OR session_id = $3)
         ORDER BY cursor ASC LIMIT $4`,
        [userId, afterCursor, sessionId ?? null, limit],
      );
      return result.rows.map(mapEvent);
    });
  }
}
