/**
 * Session-scoped (tab-lifetime) storage for the History unlock token. Using
 * sessionStorage rather than localStorage means a closed tab forgets the
 * unlock, so the PIN has to be re-entered next visit — the point of the
 * gate is defeated by a token that outlives the browsing session.
 */

const STORAGE_KEY = "ai-therapist:historyToken";

interface StoredToken {
  token: string;
  expiresAt: string;
}

export function getHistoryToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.token || !parsed.expiresAt) return null;
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

export function setHistoryToken(token: string, expiresAt: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt }));
}

export function clearHistoryToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}
