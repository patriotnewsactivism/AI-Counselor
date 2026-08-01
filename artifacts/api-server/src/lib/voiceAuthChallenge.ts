import { randomInt, randomUUID } from "node:crypto";

/**
 * In-memory challenge-phrase store. Single-process only -- same documented
 * caveat as createLockoutTracker in pinCrypto.ts; a multi-instance API
 * server would need this in Redis instead. Challenges are short-lived
 * (60s) and single-use (deleted on first verify attempt, success or not),
 * so the practical exposure of losing this on a restart/across instances
 * is just "the user has to ask for a new phrase," not a security hole.
 */

const CHALLENGE_TTL_MS = 60_000;

interface Challenge {
  userId: string;
  phrase: string;
  digits: string;
  expiresAt: number;
}

const challenges = new Map<string, Challenge>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(id);
  }
}

export function createChallenge(userId: string): { challengeId: string; phrase: string; expiresAt: string } {
  sweepExpired();
  const digits = Array.from({ length: 4 }, () => randomInt(0, 10)).join("");
  const phrase = digits.split("").join(" ");
  const challengeId = randomUUID();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challenges.set(challengeId, { userId, phrase, digits, expiresAt });
  return { challengeId, phrase, expiresAt: new Date(expiresAt).toISOString() };
}

/** Consumes (deletes) the challenge so it can't be reused, and returns it if valid for this user. */
export function consumeChallenge(challengeId: string, userId: string): Challenge | null {
  const challenge = challenges.get(challengeId);
  challenges.delete(challengeId);
  if (!challenge) return null;
  if (challenge.userId !== userId) return null;
  if (challenge.expiresAt <= Date.now()) return null;
  return challenge;
}

/**
 * Loose match between a Deepgram transcript and the expected digit
 * sequence -- ASR often renders spoken digits as words ("seven two nine
 * four") or numerals ("7294" or "72 94"), so this normalizes both sides to
 * a bare digit string before comparing.
 */
const WORD_TO_DIGIT: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

export function transcriptMatchesDigits(transcript: string, expectedDigits: string): boolean {
  const words = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const normalized = words.map((w) => WORD_TO_DIGIT[w] ?? w).join("");
  const onlyDigits = normalized.replace(/\D/g, "");
  return onlyDigits === expectedDigits;
}
