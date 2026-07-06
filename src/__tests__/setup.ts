import "@testing-library/jest-dom";

// jsdom doesn't have these — stub them so modules that guard with typeof don't throw
Object.defineProperty(globalThis, "localStorage", {
  value: (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
    };
  })(),
  writable: true,
});

Object.defineProperty(globalThis, "AudioContext", {
  value: class {
    state = "running";
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        connect: vi.fn(),
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        start: vi.fn(),
        stop: vi.fn(),
      };
    }
    createGain() {
      return {
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      };
    }
    resume() {
      return Promise.resolve();
    }
  },
  writable: true,
});
