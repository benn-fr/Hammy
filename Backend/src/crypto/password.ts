import { Algorithm, hash, verify } from "@node-rs/argon2";

const options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  return verify(encodedHash, password);
}

