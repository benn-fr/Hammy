import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createSessionKey, encryptSessionMetadata, generateDeviceKeys } from "../src/crypto/e2ee.js";
import { PostgresStore } from "../src/db/postgres-store.js";
import pg from "pg";

const databaseURL = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseURL)("PostgreSQL tenant enforcement", () => {
  const config: AppConfig = {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    databaseURL: databaseURL!,
    jwtSecret: "postgres-test-secret-that-is-longer-than-thirty-two-bytes",
    accessTokenTTLSeconds: 900,
    refreshTokenTTLDays: 30,
    corsOrigins: [],
    logLevel: "silent",
    inMemory: false,
    trustProxy: false,
  };
  let app: Awaited<ReturnType<typeof buildApp>>["app"] | undefined;

  afterAll(async () => {
    await app?.close();
  });

  it("runs migrations through the non-superuser role and isolates two real tenants", async () => {
    const store = new PostgresStore(databaseURL!);
    const built = await buildApp({ config, store });
    app = built.app;

    const register = async (label: string) => {
      const keys = generateDeviceKeys();
      const response = await app!.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: `${label}-${crypto.randomUUID()}@example.com`,
          password: "correct horse battery staple",
          displayName: label,
          device: {
            name: `${label} iPhone`,
            platform: "ios",
            agreementPublicKey: keys.agreementPublicKey,
            signingPublicKey: keys.signingPublicKey,
          },
        },
      });
      expect(response.statusCode).toBe(201);
      return { body: response.json(), keys };
    };

    const alice = await register("alice");
    const bob = await register("bob");
    const sessionId = crypto.randomUUID();
    const metadata = encryptSessionMetadata({
      plaintext: Buffer.from("PostgreSQL RLS secret"),
      sessionKey: createSessionKey(),
      keyId: "postgres-session-key",
      userId: alice.body.user.id,
      sessionId,
      senderDeviceId: alice.body.device.id,
      signingPrivateKeyPEM: alice.keys.signingPrivateKeyPEM,
    });
    const create = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${alice.body.tokens.accessToken}` },
      payload: { id: sessionId, encryptedMetadata: metadata },
    });
    expect(create.statusCode).toBe(201);

    const aliceSessions = await store.listRelaySessions(alice.body.user.id, false);
    const bobSessions = await store.listRelaySessions(bob.body.user.id, false);
    expect(aliceSessions.some((session) => session.id === sessionId)).toBe(true);
    expect(bobSessions.some((session) => session.id === sessionId)).toBe(false);
    expect(await store.getRelaySession(bob.body.user.id, sessionId)).toBeNull();

    const directClient = new pg.Client({ connectionString: databaseURL! });
    await directClient.connect();
    try {
      await directClient.query("BEGIN");
      await directClient.query("SELECT set_config('app.current_user_id', $1, true)", [bob.body.user.id]);
      const bypassAttempt = await directClient.query<{ id: string }>("SELECT id FROM relay_sessions");
      expect(bypassAttempt.rows.some((row) => row.id === sessionId)).toBe(false);
      await directClient.query("ROLLBACK");
    } finally {
      await directClient.end();
    }
  });
});
