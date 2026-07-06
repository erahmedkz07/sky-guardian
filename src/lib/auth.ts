/** Shared auth utilities — used by the root layout and public routes. */

export function isTokenValid(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return !payload.exp || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/**
 * Module-level session flag.
 * Once the JWT has been confirmed by the server we skip the network round-trip
 * on every route change.  The flag resets automatically on a full page reload
 * (e.g. after logout).
 */
let _verified = false;

export const sessionAuth = {
  get verified() {
    return _verified;
  },
  markVerified() {
    _verified = true;
  },
  clear() {
    _verified = false;
  },
};
