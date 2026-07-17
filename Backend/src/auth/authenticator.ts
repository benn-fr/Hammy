import type { FastifyReply, FastifyRequest } from "fastify";
import type { Store } from "../db/store.js";
import type { TokenService } from "../crypto/tokens.js";
import type { AccessClaims } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AccessClaims | null;
  }
}

export class AuthenticationError extends Error {
  readonly code = "unauthorized";
}

export class AuthorizationError extends Error {
  readonly code = "forbidden";
}

export function createAuthenticator(store: Store, tokens: TokenService) {
  async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new AuthenticationError("A bearer access token is required");
    let claims: AccessClaims;
    try {
      claims = await tokens.verifyAccessToken(authorization.slice(7));
    } catch {
      throw new AuthenticationError("Access token is invalid or expired");
    }
    const [authSession, device] = await Promise.all([
      store.getAuthSession(claims.authSessionId),
      store.getDevice(claims.userId, claims.deviceId),
    ]);
    if (
      !authSession || authSession.userId !== claims.userId || authSession.deviceId !== claims.deviceId ||
      authSession.revokedAt || new Date(authSession.expiresAt) <= new Date() || !device || device.trustState === "revoked"
    ) {
      throw new AuthenticationError("Access session is no longer valid");
    }
    request.auth = { ...claims, trusted: device.trustState === "trusted" };
  }

  async function requireTrusted(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticate(request, reply);
    if (!request.auth?.trusted) throw new AuthorizationError("This device is waiting for approval from a trusted device");
  }

  return { authenticate, requireTrusted };
}

export type Authenticator = ReturnType<typeof createAuthenticator>;

