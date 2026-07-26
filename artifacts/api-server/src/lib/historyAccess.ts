import { createHmac, timingSafeEqual } from "node:crypto";
import { hashPin, verifyPin, createLockoutTracker } from "./pinCrypto";

/**
 * Gates access to a user's past conversations behind a PIN, separate from
 * Clerk auth — a second factor for a device someone else might pick up
 * mid-session. Token is a stateless HMAC over {userId, expiresAt} signed
 * with SESSION_SECRET, so verification needs no server-side storage.
 */

export { hashPin, verifyPin };

const TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

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

const historyLockout = createLockoutTracker(MAX_FAILED_ATTEMPTS, LOCKOUT_MS);

export const isHistoryLockedOut = historyLockout.isLockedOut;
export const recordFailedHistoryAttempt = historyLockout.recordFailedAttempt;
export const clearFailedHistoryAttempts = historyLockout.clearFailedAttempts;
