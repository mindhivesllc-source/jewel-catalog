/**
 * Encryption at rest for secrets stored in Postgres (supplier API key,
 * Shopify access/refresh tokens). AES-256-GCM; values are prefixed so rows
 * written before encryption existed keep working and are upgraded on the
 * next write.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY or SHOPIFY_API_SECRET must be set to store secrets.",
    );
  }
  return createHash("sha256").update(`jewel-catalog:${secret}`).digest();
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return (
    PREFIX +
    [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(":")
  );
}

/**
 * Returns the plaintext. Legacy plaintext values pass through unchanged.
 * Returns "" when the value cannot be decrypted (key rotated / corrupted),
 * so callers treat it as "not configured" instead of crashing.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored;
  try {
    const [iv, tag, body] = stored
      .slice(PREFIX.length)
      .split(":")
      .map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return "";
  }
}
