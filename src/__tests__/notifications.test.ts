import { describe, it, expect, beforeEach, vi } from "vitest";
import { isNotifEnabled, setNotifEnabled, pushNotif } from "@/lib/notifications";

describe("notifications — permission guard", () => {
  beforeEach(() => {
    localStorage.clear();
    // Simulate granted permission
    Object.defineProperty(globalThis, "Notification", {
      value: class {
        static permission = "granted";
        constructor(
          public title: string,
          public options?: object,
        ) {}
      },
      writable: true,
      configurable: true,
    });
  });

  it("isNotifEnabled returns true when permission granted and not disabled", () => {
    expect(isNotifEnabled()).toBe(true);
  });

  it("isNotifEnabled returns false when user disabled via localStorage", () => {
    setNotifEnabled(false);
    expect(isNotifEnabled()).toBe(false);
  });

  it("isNotifEnabled returns false when permission denied", () => {
    Object.defineProperty(globalThis.Notification, "permission", {
      value: "denied",
      configurable: true,
    });
    expect(isNotifEnabled()).toBe(false);
  });

  it("pushNotif does not throw when tab is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    expect(() => pushNotif("Test", "Body", "critical")).not.toThrow();
  });

  it("pushNotif is silent when tab is visible (no double alert)", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    const spy = vi.fn();
    Object.defineProperty(globalThis, "Notification", {
      value: spy,
      writable: true,
      configurable: true,
    });
    pushNotif("Test", "Body", "critical");
    expect(spy).not.toHaveBeenCalled();
  });
});
