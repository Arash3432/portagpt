import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

const VERSION = "1";
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 32;
const MAX_MEMORY = 64 * 1024 * 1024;
const MAX_CONCURRENT_HASHES = 4;
const MAX_HASH_QUEUE = 64;
let activeHashes = 0;
const hashQueue: Array<() => void> = [];
const DUMMY_HASH = `scrypt$${VERSION}$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(KEY_BYTES).toString("base64url")}`;

const commonPasswords = new Set([
  "1234567890", "12345678901", "password123", "password1234", "qwerty12345",
  "admin123456", "portal12345", "1111111111", "0000000000", "abcdefgh123",
]);

function passwordPepper() {
  return createHmac("sha256", getEnv().SESSION_PEPPER)
    .update("portal-ai/password-pepper/v1")
    .digest();
}

function prehash(password: string) {
  return createHmac("sha256", passwordPepper()).update(password, "utf8").digest();
}

async function withHashSlot<T>(operation: () => Promise<T>) {
  if (activeHashes >= MAX_CONCURRENT_HASHES) {
    if (hashQueue.length >= MAX_HASH_QUEUE) throw new Error("PASSWORD_HASH_BUSY");
    await new Promise<void>((resolve) => hashQueue.push(resolve));
  } else {
    activeHashes += 1;
  }
  try { return await operation(); }
  finally {
    // Transfer the occupied slot directly to the oldest waiter. Decrementing
    // before its continuation runs can briefly admit an extra expensive hash.
    const next = hashQueue.shift();
    if (next) next();
    else activeHashes -= 1;
  }
}

function derive(input: Buffer, salt: Buffer, cost = COST, blockSize = BLOCK_SIZE, parallelism = PARALLELISM) {
  return withHashSlot(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(input, salt, KEY_BYTES, { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  }));
}

export type PasswordPolicyCode = "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" | "PASSWORD_NEEDS_LETTER_AND_NUMBER" | "PASSWORD_TOO_COMMON";

export function passwordPolicyError(password: string): PasswordPolicyCode | null {
  if (password.length < 10) return "PASSWORD_TOO_SHORT";
  if (password.length > 128) return "PASSWORD_TOO_LONG";
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) return "PASSWORD_NEEDS_LETTER_AND_NUMBER";
  if (commonPasswords.has(password.toLocaleLowerCase("en-US").replace(/\s/g, ""))) return "PASSWORD_TOO_COMMON";
  return null;
}

export async function hashPassword(password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new Error(policyError);
  const salt = randomBytes(16);
  const key = await derive(prehash(password), salt);
  return `scrypt$${VERSION}$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash: string | null | undefined) {
  const encoded = encodedHash || DUMMY_HASH;
  const parts = encoded.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== VERSION) {
    await derive(prehash(password), Buffer.alloc(16));
    return false;
  }
  const cost = Number(parts[2]);
  const blockSize = Number(parts[3]);
  const parallelism = Number(parts[4]);
  if (cost !== COST || blockSize !== BLOCK_SIZE || parallelism !== PARALLELISM) {
    await derive(prehash(password), Buffer.alloc(16));
    return false;
  }
  try {
    const salt = Buffer.from(parts[5], "base64url");
    const expected = Buffer.from(parts[6], "base64url");
    if (salt.length !== 16 || expected.length !== KEY_BYTES) return false;
    const actual = await derive(prehash(password), salt, cost, blockSize, parallelism);
    return timingSafeEqual(actual, expected);
  } catch (error) {
    if (error instanceof Error && error.message === "PASSWORD_HASH_BUSY") throw error;
    return false;
  }
}
