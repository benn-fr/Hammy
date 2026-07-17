import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { AccessClaims } from "../types.js";

const issuer = "hammy-backend";
const audience = "hammy-clients";

export class TokenService {
  private readonly key: Uint8Array;

  constructor(secret: string, private readonly accessTTLSeconds: number) {
    this.key = new TextEncoder().encode(secret);
  }

  async issueAccessToken(claims: AccessClaims): Promise<string> {
    return new SignJWT({
      did: claims.deviceId,
      sid: claims.authSessionId,
      trusted: claims.trusted,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(claims.userId)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTTLSeconds}s`)
      .setJti(crypto.randomUUID())
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.key, { issuer, audience });
    if (typeof payload.sub !== "string" || typeof payload.did !== "string" || typeof payload.sid !== "string" || typeof payload.trusted !== "boolean") {
      throw new Error("Access token is missing required claims");
    }
    return {
      userId: payload.sub,
      deviceId: payload.did,
      authSessionId: payload.sid,
      trusted: payload.trusted,
    };
  }
}

export function createRefreshToken(authSessionId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return {
    token: `${authSessionId}.${secret}`,
    hash: hashRefreshSecret(secret),
  };
}

export function createLoginChallenge(): { challenge: string; hash: string } {
  const challenge = randomBytes(32).toString("base64url");
  return { challenge, hash: hashOpaqueSecret(challenge) };
}

export function hashLoginChallenge(challenge: string): string {
  return hashOpaqueSecret(challenge);
}

export function parseRefreshToken(token: string): { authSessionId: string; hash: string } {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw new Error("Invalid refresh token");
  }
  const authSessionId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(authSessionId) || !/^[A-Za-z0-9_-]{40,}$/.test(secret)) {
    throw new Error("Invalid refresh token");
  }
  return { authSessionId, hash: hashRefreshSecret(secret) };
}

function hashRefreshSecret(secret: string): string {
  return hashOpaqueSecret(secret);
}

function hashOpaqueSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}
