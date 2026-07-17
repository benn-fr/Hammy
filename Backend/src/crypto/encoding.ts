import { timingSafeEqual } from "node:crypto";

export function encodeBase64URL(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function decodeBase64URL(value: string, expectedLength?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Non-canonical base64url value");
  }
  if (expectedLength !== undefined && decoded.byteLength !== expectedLength) {
    throw new Error(`Expected ${expectedLength} decoded bytes`);
  }
  return decoded;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function canonicalFields(fields: readonly string[]): Buffer {
  const chunks = ["hammy-canonical-v1\n"];
  for (const field of fields) {
    chunks.push(`${Buffer.byteLength(field, "utf8")}:${field}`);
  }
  return Buffer.from(chunks.join(""), "utf8");
}

