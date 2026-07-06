import { describe, it, expect, beforeEach } from "vitest";
import { isTokenValid, sessionAuth } from "@/lib/auth";

function makeJwt(exp: number | null): string {
  const payload = exp !== null ? { exp } : { userId: "1" };
  const b64 = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.fakesig`;
}

describe("isTokenValid", () => {
  it("returns false for an empty string", () => {
    expect(isTokenValid("")).toBe(false);
  });

  it("returns false for a malformed token", () => {
    expect(isTokenValid("not.a.jwt")).toBe(false);
    expect(isTokenValid("bad")).toBe(false);
  });

  it("returns false for an expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    expect(isTokenValid(makeJwt(exp))).toBe(false);
  });

  it("returns true for a valid non-expired token", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    expect(isTokenValid(makeJwt(exp))).toBe(true);
  });

  it("returns true for a token with no exp claim", () => {
    expect(isTokenValid(makeJwt(null))).toBe(true);
  });
});

describe("sessionAuth", () => {
  beforeEach(() => {
    sessionAuth.clear();
  });

  it("starts unverified", () => {
    expect(sessionAuth.verified).toBe(false);
  });

  it("markVerified sets verified to true", () => {
    sessionAuth.markVerified();
    expect(sessionAuth.verified).toBe(true);
  });

  it("clear resets verified to false", () => {
    sessionAuth.markVerified();
    sessionAuth.clear();
    expect(sessionAuth.verified).toBe(false);
  });
});
