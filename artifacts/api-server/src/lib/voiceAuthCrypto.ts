import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encrypt/decrypt for the voice-auth feature vector before it
 * touches the database -- so a raw DB dump/leak yields ciphertext, not a
 * usable biometric template. Key lives only in the Railway env var below,
 * never in application code or in this repo.
 */

function getKey(): Buffer {
  const raw = process.env.VOICE_AUTH_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "VOICE_AUTH_ENCRYPTION_KEY must be set (32 random bytes, base64-encoded) -- Voice ID cannot store templates without it.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("VOICE_AUTH_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptVector(vector: number[]): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(vector), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv (12) + authTag (16) + ciphertext, all base64 in one string
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptVector(stored: string): number[] {
  const key = getKey();
  const buffer = Buffer.from(stored, "base64");
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
