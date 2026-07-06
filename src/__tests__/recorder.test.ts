import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startRecorder, stopRecorder, getFrames, clearFrames, isRecording } from "@/lib/recorder";
import type { Drone } from "@/lib/mockData";

function makeDrone(overrides: Partial<Drone> = {}): Drone {
  return {
    id: "d1",
    callsign: "ALPHA-1",
    model: "DJI Phantom",
    lat: 51.18,
    lng: 71.45,
    altitude: 120,
    speed: 60,
    heading: 90,
    threat: "low",
    status: "tracked",
    detectedAt: new Date(),
    confidence: 0.9,
    vLat: 0.001,
    vLng: 0.001,
    ...overrides,
  };
}

describe("recorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearFrames();
    stopRecorder();
  });
  afterEach(() => {
    stopRecorder();
    vi.useRealTimers();
  });

  it("starts with no frames", () => {
    expect(getFrames()).toHaveLength(0);
  });

  it("isRecording returns false before start", () => {
    expect(isRecording()).toBe(false);
  });

  it("isRecording returns true after start", () => {
    startRecorder(() => []);
    expect(isRecording()).toBe(true);
  });

  it("records a frame each second", () => {
    const drone = makeDrone();
    startRecorder(() => [drone]);

    vi.advanceTimersByTime(3000);

    expect(getFrames().length).toBeGreaterThanOrEqual(3);
  });

  it("each frame contains correct drone data", () => {
    const drone = makeDrone({ lat: 51.99, lng: 71.11, threat: "high" });
    startRecorder(() => [drone]);
    vi.advanceTimersByTime(1000);

    const frames = getFrames();
    expect(frames.length).toBeGreaterThan(0);
    const frame = frames[0];
    expect(frame.drones[0].lat).toBe(51.99);
    expect(frame.drones[0].lng).toBe(71.11);
    expect(frame.drones[0].threat).toBe("high");
    expect(frame.drones[0].callsign).toBe("ALPHA-1");
  });

  it("stopRecorder stops accumulating frames", () => {
    startRecorder(() => [makeDrone()]);
    vi.advanceTimersByTime(2000);
    const countAfterStop = getFrames().length;
    stopRecorder();
    vi.advanceTimersByTime(3000);
    expect(getFrames().length).toBe(countAfterStop);
  });

  it("clearFrames empties the buffer", () => {
    startRecorder(() => [makeDrone()]);
    vi.advanceTimersByTime(2000);
    clearFrames();
    expect(getFrames()).toHaveLength(0);
  });

  it("caps buffer at MAX_TRAIL (300) frames", () => {
    startRecorder(() => [makeDrone()]);
    vi.advanceTimersByTime(400_000); // 400 seconds — would be 400 frames without cap
    expect(getFrames().length).toBeLessThanOrEqual(300);
  });
});
