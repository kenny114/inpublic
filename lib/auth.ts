/**
 * A deliberate seam for a real authentication provider.
 *
 * There is no account system yet, and the product must not pretend otherwise.
 * This keeps a single browser-local record of "who is signed in" so the header,
 * the dashboard and the login page can agree on one auth state today, and so
 * swapping in a real session (cookie, JWT, provider SDK) later only means
 * replacing the four functions below.
 *
 * Nothing here is a security boundary: it stores an email in localStorage and
 * grants no access to anything the browser did not already have. No password
 * is asked for, and none is stored.
 */

export type AuthUser = { email: string; signedInAt: string };

export type AuthState = {
  /** False until the browser-only value has been read, so SSR and the first
   *  client render can agree on a single neutral state. */
  ready: boolean;
  user: AuthUser | null;
};

export const SIGNED_OUT: AuthState = { ready: false, user: null };

const KEY = "inpublic-auth";
const EVENT = "inpublic-auth-change";

export function readAuth(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    return typeof parsed?.email === "string" && parsed.email
      ? { email: parsed.email, signedInAt: parsed.signedInAt ?? "" }
      : null;
  } catch {
    return null;
  }
}

export function signIn(email: string): AuthUser {
  const user: AuthUser = { email, signedInAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    /* private mode — the session simply does not outlive the tab */
  }
  window.dispatchEvent(new Event(EVENT));
  return user;
}

export function signOut(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Same-tab changes fire `EVENT`; other tabs fire `storage`. */
export function subscribeAuth(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
