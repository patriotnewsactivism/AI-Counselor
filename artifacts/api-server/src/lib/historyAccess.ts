import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Gates access to a user's past conversations behind a PIN, separate from
 * Clerk auth — a second factor for a device someone else might pick up
 * mid-session. Token is a stateless HMAC over {userId, expiresAt} signed
 * with SESSION_SECRET, so verification needs no server-side storage.
 */

const SCRYPT_KEYLEN = 64;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set");
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createHistoryToken(userId: string): { token: string; expiresAt: string } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payloadB64 = Buffer.from(JSON.stringify({ userId, expiresAt }), "utf8").toString("base64url");
  const signature = sign(payloadB64);
  return { token: `${payloadB64}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
}

export function verifyHistoryToken(token: string | undefined | null, userId: string): boolean {
  if (!token) return false;
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return false;

  const expectedSignature = sign(payloadB64);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return false;
  }

  let payload: { userId?: unknown; expiresAt?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  return (
    payload.userId === userId &&
    typeof payload.expiresAt === "number" &&
    Date.now() <= payload.expiresAt
  );
}

// In-memory per-userId lockout for unlock attempts. Single-process only —
// good enough for this deploy's scale; would need a shared store (e.g.
// Redis) behind a multi-instance API server.
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

export function isHistoryLockedOut(userId: string): boolean {
  const entry = failedAttempts.get(userId);
  if (!entry?.lockedUntil) return false;
  if (Date.now() >= entry.lockedUntil) {
    failedAttempts.delete(userId);
    return false;
  }
  return true;
}

export function recordFailedHistoryAttempt(userId: string): void {
  const entry = failedAttempts.get(userId) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failedAttempts.set(userId, entry);
}

export function clearFailedHistoryAttempts(userId: string): void {
  failedAttempts.delete(userId);
}
