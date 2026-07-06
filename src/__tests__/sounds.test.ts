import { describe, it, expect, beforeEach } from "vitest";
import { isMuted, setMuted, toggleMute } from "@/lib/sounds";

describe("sounds — mute state", () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(false);
  });

  it("starts unmuted by default", () => {
    expect(isMuted()).toBe(false);
  });

  it("setMuted(true) mutes", () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
  });

  it("setMuted persists to localStorage", () => {
    setMuted(true);
    expect(localStorage.getItem("sg_muted")).toBe("true");
  });

  it("toggleMute flips state and returns new value", () => {
    const first = toggleMute();
    expect(first).toBe(true);
    expect(isMuted()).toBe(true);

    const second = toggleMute();
    expect(second).toBe(false);
    expect(isMuted()).toBe(false);
  });

  it("double toggle returns to original state", () => {
    const before = isMuted();
    toggleMute();
    toggleMute();
    expect(isMuted()).toBe(before);
  });
});
