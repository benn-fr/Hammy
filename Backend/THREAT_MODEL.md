# Threat model

## Protected data

Hammy treats session titles, prompts, transcripts, status updates, approval details, command output, uploaded-photo references, and detailed usage records as encrypted content.

The relay is designed so a database dump, backup operator, API operator, or passive network observer cannot decrypt that content without a trusted endpoint's private keys.

## Trusted components

- The user's unlocked iPhone running an authentic Hammy build.
- The user's trusted Mac companion that talks to the Codex app server.
- Apple platform cryptography and Keychain on those devices.
- The user when comparing and approving a new device.

The Codex host necessarily sees plaintext because it must execute the user's request. E2EE protects the path and storage between trusted endpoints; it does not make a compromised endpoint safe.

## Adversaries considered

- A different authenticated Hammy account attempting horizontal object access.
- A database reader or backup leak.
- A relay operator attempting to inspect content.
- A network observer.
- A stolen access token without the device signing key.
- A malicious pending device with the correct account password.
- Ciphertext alteration, sender impersonation, replay, and nonce reuse.
- A revoked device attempting to receive future session content.

## Controls

- Every tenant query carries a user ID; PostgreSQL row-level security repeats the boundary.
- Access tokens are short-lived and checked against live auth-session and device state.
- Existing-device login requires the password and an Ed25519 signature over a one-use, expiring server challenge.
- Refresh tokens are random, hashed at rest, one-use, rotated, and family-revoked on replay.
- A password-authenticated new device remains pending. An existing trusted device must sign its exact public keys before access is granted.
- Content mutations and destructive device/session actions require registered-device signatures in addition to bearer authentication.
- Associated data binds ciphertext to user, session, message, sender, key, timestamp, and notification hint.
- Ed25519 signatures bind encrypted objects to a registered device identity.
- Message IDs are idempotent and nonces are unique per session key.
- Device revocation invalidates its login sessions and freezes future event writes until a fresh key is packaged to every remaining trusted device.
- Key activation epochs increase exactly by one and key IDs are never reusable within a session, blocking captured activation replays.
- After revocation, replacement key packages must have server receipt times at or after the revocation timestamp, preventing activation of a pre-shared key known to the removed device.
- The server never accepts or stores a session content key.

## Metadata visible to the relay

E2EE does not hide all metadata. The relay can observe:

- account and device identifiers;
- email address and display name;
- registered device names, platforms, and public keys;
- session IDs, sender device IDs, timestamps, cursor order, and ciphertext sizes;
- content-key identifiers and recipient relationships;
- the coarse notification hint (`none`, `generic`, or `attention`);
- connection IP addresses and request timing.

Hiding these fields would require a substantially different anonymous-routing and private-notification design. Do not describe the current protocol as metadata-private.

## Non-goals and remaining work

- A compromised or jailbroken endpoint can read data available to that endpoint.
- Revocation cannot erase plaintext or old keys already copied by a device; it prevents access to newly encrypted data after rotation.
- The server does not currently support E2EE session sharing between different user accounts. That requires a group membership and key-epoch protocol.
- Email verification, password reset, passkeys, account recovery, APNs sending, distributed rate limits, and shared WebSocket pub/sub are deployment work.
- Losing every trusted device and any offline recovery secret makes existing encrypted data unrecoverable. No server-side content-key escrow exists.
- Traffic analysis and ciphertext-size analysis are not prevented.

## Recovery recommendation

Before public release, add a user-controlled recovery key generated on a trusted device. Wrap session keys to that recovery public key and let the user store an offline recovery secret. Do not upload an unencrypted recovery secret or silently escrow it with the relay.
