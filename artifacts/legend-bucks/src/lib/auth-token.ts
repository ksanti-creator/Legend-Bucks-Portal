// Session token persistence.
//
// The live session token is stored in localStorage and sent as an
// `Authorization: Bearer <token>` header on every API request (header auth
// works inside the Replit preview iframe where third-party cookies are blocked).
//
// Training mode (URL under /training/portal) uses a completely separate
// sessionStorage key. In training, the live token is never read or written.

import { IS_TRAINING, getTrainingToken, clearTrainingSession } from "./training";

const STORAGE_KEY = "legend_bucks_session_token";

/** The live (non-training) token, regardless of mode. Only used by the training launch page. */
export function getNormalSessionToken(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function getSessionToken(): string | null {
  if (IS_TRAINING) return getTrainingToken();
  return getNormalSessionToken();
}

export function setSessionToken(token: string): void {
  if (IS_TRAINING) return; // Training sessions are only created by the launch page.
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Ignore storage failures (e.g. private mode); auth will just not persist.
  }
}

export function clearSessionToken(): void {
  if (IS_TRAINING) { clearTrainingSession(); return; }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
