import { createPublicKey, verify } from "node:crypto";
import { decodeBase64URL } from "./encoding.js";

export function ed25519PublicKeyFromRaw(encoded: string) {
  const raw = decodeBase64URL(encoded, 32);
  return createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: raw.toString("base64url"),
    },
    format: "jwk",
  });
}

export function verifyEd25519(publicKey: string, payload: Uint8Array, encodedSignature: string): boolean {
  try {
    const signature = decodeBase64URL(encodedSignature, 64);
    return verify(null, payload, ed25519PublicKeyFromRaw(publicKey), signature);
  } catch {
    return false;
  }
}

