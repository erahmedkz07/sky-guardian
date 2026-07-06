/**
 * Tactical sound system using Web Audio API.
 * No external files — all sounds generated programmatically.
 */

let _ctx: AudioContext | null = null;
let _muted = typeof localStorage !== "undefined" && localStorage.getItem("sg_muted") === "true";

function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

// Browsers block audio until the user interacts with the page at least once.
// Eagerly unlock on the very first click/keydown so alert sounds never get
// silently dropped by the autoplay policy.
if (typeof window !== "undefined") {
  const unlock = () => {
    try { ctx(); } catch { /* AudioContext unsupported */ }
    window.removeEventListener("click", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("click", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function isMuted() {
  return _muted;
}

export function setMuted(val: boolean) {
  _muted = val;
  localStorage.setItem("sg_muted", String(val));
}

export function toggleMute() {
  setMuted(!_muted);
  return _muted;
}

function beep(freq: number, duration: number, gain: number, type: OscillatorType = "square") {
  if (_muted) return;
  const c = ctx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.connect(g);
  g.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

function sequence(
  notes: { freq: number; at: number; dur: number; gain?: number; type?: OscillatorType }[],
) {
  if (_muted) return;
  notes.forEach(({ freq, at, dur, gain = 0.15, type = "square" }) => {
    setTimeout(() => beep(freq, dur, gain, type), at * 1000);
  });
}

// ─── Threat sounds ────────────────────────────────────────────

/** CRITICAL: rapid double-pulse alarm */
export function playCritical() {
  sequence([
    { freq: 880, at: 0.0, dur: 0.12, gain: 0.25 },
    { freq: 880, at: 0.18, dur: 0.12, gain: 0.25 },
    { freq: 1100, at: 0.4, dur: 0.12, gain: 0.28 },
    { freq: 1100, at: 0.58, dur: 0.12, gain: 0.28 },
    { freq: 880, at: 0.8, dur: 0.12, gain: 0.25 },
    { freq: 880, at: 0.98, dur: 0.12, gain: 0.25 },
  ]);
}

/** HIGH: two-tone warning */
export function playHigh() {
  sequence([
    { freq: 660, at: 0.0, dur: 0.18, gain: 0.2 },
    { freq: 880, at: 0.25, dur: 0.18, gain: 0.2 },
    { freq: 660, at: 0.55, dur: 0.18, gain: 0.18 },
  ]);
}

/** MEDIUM: single ping */
export function playMedium() {
  beep(520, 0.25, 0.15, "sine");
}

/** LOW: subtle click */
export function playLow() {
  beep(320, 0.12, 0.08, "sine");
}

/** System online chime */
export function playOnline() {
  sequence([
    { freq: 440, at: 0.0, dur: 0.1, gain: 0.1, type: "sine" },
    { freq: 550, at: 0.12, dur: 0.1, gain: 0.1, type: "sine" },
    { freq: 660, at: 0.24, dur: 0.2, gain: 0.1, type: "sine" },
  ]);
}

export function playByLevel(level: "low" | "medium" | "high" | "critical") {
  switch (level) {
    case "critical":
      playCritical();
      break;
    case "high":
      playHigh();
      break;
    case "medium":
      playMedium();
      break;
    case "low":
      playLow();
      break;
  }
}
