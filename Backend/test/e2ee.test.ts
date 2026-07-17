import { describe, expect, it } from "vitest";
import {
  createSessionKey,
  decryptEvent,
  decryptSessionMetadata,
  encryptEvent,
  encryptSessionMetadata,
  generateDeviceKeys,
  unwrapSessionKey,
  wrapSessionKey,
} from "../src/crypto/e2ee.js";

describe("Hammy E2EE protocol", () => {
  it("encrypts and authenticates session metadata and events", () => {
    const sender = generateDeviceKeys();
    const sessionKey = createSessionKey();
    const context = {
      userId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      senderDeviceId: crypto.randomUUID(),
      keyId: "session-key-v1",
    };
    const metadataPlaintext = Buffer.from(JSON.stringify({ title: "Secret Hammy session" }));
    const metadata = encryptSessionMetadata({
      ...context,
      plaintext: metadataPlaintext,
      sessionKey,
      signingPrivateKeyPEM: sender.signingPrivateKeyPEM,
    });
    expect(metadata.ciphertext).not.toContain("Secret");
    expect(decryptSessionMetadata({
      envelope: metadata,
      sessionKey,
      senderSigningPublicKey: sender.signingPublicKey,
      userId: context.userId,
      sessionId: context.sessionId,
      senderDeviceId: context.senderDeviceId,
    })).toEqual(metadataPlaintext);

    const eventPlaintext = Buffer.from(JSON.stringify({ update: "Approval is waiting" }));
    const messageId = crypto.randomUUID();
    const event = encryptEvent({
      ...context,
      plaintext: eventPlaintext,
      sessionKey,
      messageId,
      notificationHint: "attention",
      signingPrivateKeyPEM: sender.signingPrivateKeyPEM,
    });
    expect(decryptEvent({
      envelope: event,
      sessionKey,
      senderSigningPublicKey: sender.signingPublicKey,
      userId: context.userId,
      sessionId: context.sessionId,
      messageId,
      senderDeviceId: context.senderDeviceId,
      notificationHint: "attention",
    })).toEqual(eventPlaintext);
  });

  it("wraps a session key to one recipient and rejects another", () => {
    const sender = generateDeviceKeys();
    const recipient = generateDeviceKeys();
    const stranger = generateDeviceKeys();
    const sessionKey = createSessionKey();
    const context = {
      userId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      senderDeviceId: crypto.randomUUID(),
      recipientDeviceId: crypto.randomUUID(),
      keyId: "session-key-v1",
    };
    const envelope = wrapSessionKey({
      ...context,
      sessionKey,
      recipientAgreementPublicKey: recipient.agreementPublicKey,
      signingPrivateKeyPEM: sender.signingPrivateKeyPEM,
    });
    const unwrapped = unwrapSessionKey({
      envelope,
      ...context,
      senderSigningPublicKey: sender.signingPublicKey,
      recipientAgreementPrivateKeyPEM: recipient.agreementPrivateKeyPEM,
    });
    expect(unwrapped).toEqual(sessionKey);
    expect(() => unwrapSessionKey({
      envelope,
      ...context,
      senderSigningPublicKey: sender.signingPublicKey,
      recipientAgreementPrivateKeyPEM: stranger.agreementPrivateKeyPEM,
    })).toThrow();
  });

  it("rejects tampering before returning plaintext", () => {
    const sender = generateDeviceKeys();
    const sessionKey = createSessionKey();
    const context = {
      userId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      senderDeviceId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      keyId: "session-key-v1",
    };
    const envelope = encryptEvent({
      ...context,
      plaintext: Buffer.from("top secret"),
      sessionKey,
      signingPrivateKeyPEM: sender.signingPrivateKeyPEM,
    });
    const bytes = Buffer.from(envelope.ciphertext, "base64url");
    bytes[0] = bytes[0]! ^ 1;
    const tampered = { ...envelope, ciphertext: bytes.toString("base64url") };
    expect(() => decryptEvent({
      envelope: tampered,
      sessionKey,
      senderSigningPublicKey: sender.signingPublicKey,
      userId: context.userId,
      sessionId: context.sessionId,
      messageId: context.messageId,
      senderDeviceId: context.senderDeviceId,
    })).toThrow("signature");
  });
});

