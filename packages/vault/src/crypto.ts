import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Load the per-deployment vault key (32 bytes) from AOS_VAULT_KEY (base64).
 * Throws if missing/invalid — secrets must never be encrypted with a default key.
 */
export function loadVaultKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.AOS_VAULT_KEY;
  if (!raw) throw new Error("AOS_VAULT_KEY is required (base64-encoded 32 bytes)");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("AOS_VAULT_KEY must decode to exactly 32 bytes");
  return key;
}

/** Generate a fresh base64 vault key (use once per deployment; store as AOS_VAULT_KEY). */
export function generateVaultKey(): string {
  return randomBytes(32).toString("base64");
}

/** Encrypt plaintext → base64(iv | authTag | ciphertext). */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a blob produced by encrypt(). Throws on tampering (GCM auth failure). */
export function decrypt(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
