import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv, isProduction } from "./env";

type EncryptedSecret = { ciphertext: string; iv: string; authTag: string };

function vaultKey() {
  const configured = getEnv().CONFIG_ENCRYPTION_KEY?.trim();
  if (!configured) {
    if (isProduction()) throw new Error("CONFIG_VAULT_NOT_CONFIGURED");
    return Buffer.from(getEnv().SESSION_PEPPER.slice(0, 32).padEnd(32, "0"), "utf8");
  }
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("CONFIG_VAULT_KEY_INVALID");
  return key;
}

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
