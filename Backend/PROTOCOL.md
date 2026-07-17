# Hammy E2EE protocol v1

This document is normative for the TypeScript and Swift implementations in this repository.

## Primitives

- Device agreement keys: X25519.
- Device signatures: Ed25519.
- Content encryption: ChaCha20-Poly1305 with a 96-bit random nonce and 128-bit tag.
- Key derivation: HKDF-SHA256, 256-bit output.
- Session content keys: 256 random bits.
- Key-package salts: 128 random bits.
- Encoding: unpadded, canonical base64url.

## Canonical fields

Signatures, AEAD associated data, and HKDF info use a deterministic length-prefixed encoding:

```text
hammy-canonical-v1\n
<UTF-8 byte length>:<field><UTF-8 byte length>:<field>...
```

Field order is fixed in `src/crypto/canonical.ts` and `HammyE2EE.swift`. Do not replace this with ordinary JSON serialization; JSON property order and number rendering are not a portable signature format.

## Event envelope

```json
{
  "version": 1,
  "algorithm": "chacha20-poly1305",
  "keyId": "opaque-session-key-id",
  "nonce": "base64url-12-bytes",
  "ciphertext": "base64url-ciphertext-plus-16-byte-tag",
  "clientCreatedAt": "RFC-3339 timestamp",
  "signature": "base64url-64-byte-Ed25519-signature"
}
```

Event AEAD associated data binds protocol label, user ID, session ID, message ID, sender device ID, notification hint, version, algorithm, key ID, nonce, and client timestamp. The signature additionally binds the ciphertext.

Session metadata uses its own domain-separated labels and omits message ID and notification hint.

## Session-key package

For each recipient device:

1. Generate a fresh ephemeral X25519 key pair.
2. Calculate X25519 using the ephemeral private key and recipient identity public key.
3. Derive 32 bytes with HKDF-SHA256, a random 16-byte salt, and domain-separated context containing user, session, sender, recipient, and key ID.
4. Encrypt the 32-byte session content key with ChaCha20-Poly1305.
5. Sign all routing fields, ephemeral key, salt, nonce, ciphertext, and creation time with the sender's Ed25519 identity key.

The recipient verifies the signature before attempting agreement or decryption.

## Device approval

A trusted device signs this domain-separated field sequence:

```text
hammy.device-approval.signature.v1
userId
approverDeviceId
pendingDeviceId
pendingAgreementPublicKey
pendingSigningPublicKey
```

The relay verifies the signature against the approver's registered Ed25519 key. Password authentication alone cannot approve a device.

## Existing-device login proof

The relay returns a random 32-byte, two-minute, one-use challenge. The device signs:

```text
hammy.login-proof.signature.v1
userId
deviceId
challengeId
challenge
```

Login succeeds only when the password, registered device, challenge hash, expiry, one-use state, and Ed25519 signature all validate. A password alone may register a new pending device, but cannot impersonate an already trusted device.

## Revocation and key activation

Revoking any trusted device sets `keyRotationRequired` on every active session. No event may be appended while that flag is set.

The remaining device creates a fresh session key after revocation, uploads a signed key package for every currently trusted device—including itself—and signs the new key ID plus the next integer epoch with the domain `hammy.key-activation.signature.v1`. The relay activates the key only if every trusted device has a matching package received after the server-recorded revocation time, the epoch is exactly current plus one, and the key ID has never appeared in that session.

The relay stores an immutable `(session, epoch, key ID)` history. Captured activation requests cannot roll a session back to a key known by a revoked device.

Old events remain encrypted under old keys. A revoked device may retain old plaintext it already possessed, but it cannot authenticate to fetch relay data and cannot decrypt new-key events unless a remaining endpoint leaks the new key.

## Versioning

Version 1 fields and algorithms are immutable. Any algorithm, canonicalization, or field-order change requires a new protocol version and explicit migration. Clients must reject unknown versions and algorithms rather than guessing.
