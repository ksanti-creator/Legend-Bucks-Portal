// Session token persistence.
//
// The session token is stored in localStorage and sent as an
// `Authorization: Bearer <token>` header on every API request. This is the
// primary auth transport because the Replit preview runs the app inside an
// iframe on a different domain than the address bar, where browsers block the
// server's session cookie as a third-party cookie. A header-based token is not
// subject to that restriction and works in the iframe, a standalone tab, and
// the deployed site.

const STORAGE_KEY = "legend_bucks_session_token";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Ignore storage failures (e.g. private mode); auth will just not persist.
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
