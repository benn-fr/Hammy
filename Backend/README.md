# Hammy backend

This directory contains the multi-user, end-to-end encrypted relay for Hammy. It is intentionally a relay rather than a service that decrypts conversations: trusted iOS and Mac/bridge devices encrypt and sign content before it reaches the API.

## Implemented

- Account registration and Argon2id password verification.
- Short-lived JWT access tokens and one-use rotating refresh tokens.
- One-use Ed25519 device challenges for every existing-device login.
- Refresh-token replay detection that revokes the affected login session.
- Multiple devices per user with `pending`, `trusted`, and `revoked` states.
- Ed25519-signed approval by an existing trusted device before a new device can access relay data.
- PostgreSQL tenant scoping plus forced row-level security on devices, sessions, key packages, and events.
- Opaque encrypted session metadata and append-only encrypted events.
- X25519/HKDF/ChaCha20-Poly1305 session-key packages addressed to individual trusted devices.
- Ed25519 verification for metadata, events, device approvals, key packages, and key activation.
- Durable event cursors, idempotent message IDs, WebSocket delivery, and reconnect backlogs.
- Nonce-reuse rejection for every session key.
- Mandatory fresh-key activation after a device is revoked.
- Monotonic key epochs and permanent per-session key-ID non-reuse.
- Payload, rate, timestamp, and pagination limits.

## Quick start

The Docker configuration uses a database administrator only for first-time bootstrap. The API connects as the separate, non-superuser `hammy_app` role so forced row-level security remains effective.

```sh
docker compose up --build
curl http://127.0.0.1:8787/healthz
```

Migrations run automatically when the backend container starts. The passwords and JWT secret in `docker-compose.yml` are local-development values and must be replaced before any shared deployment.

For an API-only in-memory development process:

```sh
npm install
npm run dev:memory
```

In-memory mode is rejected when `NODE_ENV=production`.

## Commands

```sh
npm run build       # Compile strict TypeScript
npm test            # Run cryptography and API security tests
npm run check       # Type-check and test
npm run migrate     # Apply PostgreSQL migrations
npm start           # Run the compiled service
```

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/auth/register` | Create an account and its first trusted device |
| `POST` | `/v1/auth/challenge` | Create a one-use challenge for an existing device |
| `POST` | `/v1/auth/login` | Log in with password plus device proof, or create a pending device |
| `POST` | `/v1/auth/refresh` | Atomically rotate refresh credentials |
| `POST` | `/v1/auth/logout` | Revoke the current login session |
| `GET` | `/v1/me` | Return the current user/device state |
| `GET` | `/v1/devices` | List account devices |
| `POST` | `/v1/devices/{id}/approve` | Approve a pending device with an Ed25519 signature |
| `POST` | `/v1/devices/{id}/revoke` | Signed device revocation requiring fresh session keys |
| `POST` | `/v1/sessions` | Store signed, encrypted session metadata |
| `GET` | `/v1/sessions` | List encrypted session records for the account |
| `POST` | `/v1/sessions/{id}/archive` | Archive a session with a device signature |
| `PUT` | `/v1/sessions/{id}/keys/{deviceId}` | Upload a recipient-bound key package |
| `POST` | `/v1/sessions/{id}/keys/activate` | Activate a key after all trusted devices have packages |
| `GET` | `/v1/key-packages` | Fetch key packages addressed to the current device |
| `POST` | `/v1/sessions/{id}/events` | Append a signed encrypted event |
| `GET` | `/v1/sessions/{id}/events` | Replay encrypted events using a durable cursor |
| `GET` | `/v1/events/live` | Authenticated WebSocket backlog and live stream |

Bearer authentication is required everywhere except registration, login challenge, login, refresh, and health checks. Existing-device login requires both the account password and a signature over a one-use server challenge. Pending devices may call `/v1/me` and refresh their login, but cannot access sessions, key packages, devices, or events.

## Encryption flow

1. Every device creates independent Curve25519 key-agreement and signing key pairs. Private keys remain in Keychain or the trusted bridge's protected local store.
2. A session creator generates a random 256-bit content key and encrypts session metadata with ChaCha20-Poly1305.
3. The content key is wrapped separately to every trusted device using ephemeral X25519, HKDF-SHA256, and ChaCha20-Poly1305.
4. Each encrypted object is signed with the sender's Ed25519 device key.
5. The server verifies routing-bound signatures and safety invariants, stores ciphertext, and relays it. It never receives a content key.
6. After revocation, event writes stop until a new key has a signed post-revocation package for every remaining trusted device and is explicitly activated at the next monotonic key epoch. Old epochs, pre-revocation packages, and key IDs cannot be replayed.

The matching CryptoKit implementation lives in `../Hammy/Services/HammyE2EE.swift`. A committed test decrypts a Node-generated key package and event in Swift, proving protocol interoperability.

## WebSocket protocol

Connect to `/v1/events/live` with the normal `Authorization: Bearer …` header and optional `after` and `limit` query parameters. The first frame is:

```json
{
  "type": "ready",
  "events": [],
  "nextCursor": 0
}
```

New records arrive as `{ "type": "event", "event": { ... } }`. If the ready frame has `hasMore: true`, fetch additional cursor pages before considering the local history complete. Reconnect with the last durable cursor and deduplicate by `messageId`. A connection may receive a duplicate at the backlog/live boundary; this avoids losing an event during the handoff.

## Production requirements

- Replace every local secret and use a secrets manager.
- Terminate only TLS 1.2+ and expose the service as `https://`/`wss://`.
- Run the application as a non-superuser PostgreSQL role without `BYPASSRLS`.
- Use a separate migration role if organizational policy does not allow the runtime role to own tables.
- Put auth endpoints behind distributed abuse controls and add email verification or passkeys.
- Set `TRUST_PROXY=true` only behind a proxy that strips untrusted forwarding headers; otherwise leave it false so IP rate limits cannot be spoofed.
- Add a shared pub/sub layer before running multiple API replicas; durable cursor replay remains the recovery path.
- Back up PostgreSQL ciphertext, but never device or session private keys.
- Add APNs delivery using generic notification text; never place decrypted approval details in a push payload.
- Arrange an external cryptography and application-security review before production release.

See [THREAT_MODEL.md](./THREAT_MODEL.md) and [PROTOCOL.md](./PROTOCOL.md) before changing cryptographic fields.
