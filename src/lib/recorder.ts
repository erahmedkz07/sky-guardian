import type { Drone } from "./mockData";

const MAX_FRAMES = 300; // 5 min at 1 fps
const INTERVAL_MS = 1000;

export interface DroneFrame {
  id: string;
  callsign: string;
  model: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
  threat: string;
  status: string;
}

export interface Snapshot {
  ts: number; // Date.now()
  drones: DroneFrame[];
}

let _frames: Snapshot[] = [];
let _timerId: ReturnType<typeof setInterval> | null = null;
let _getDrones: (() => Drone[]) | null = null;

export function startRecorder(getDrones: () => Drone[]) {
  if (_timerId) return;
  _getDrones = getDrones;
  _timerId = setInterval(() => {
    if (!_getDrones) return;
    const drones = _getDrones();
    const snap: Snapshot = {
      ts: Date.now(),
      drones: drones.map((d) => ({
        id: d.id,
        callsign: d.callsign,
        model: d.model,
        lat: d.lat,
        lng: d.lng,
        altitude: d.altitude,
        speed: d.speed,
        heading: d.heading,
        threat: d.threat,
        status: d.status,
      })),
    };
    _frames.push(snap);
    if (_frames.length > MAX_FRAMES) _frames.shift();
  }, INTERVAL_MS);
}

export function stopRecorder() {
  if (_timerId) {
    clearInterval(_timerId);
    _timerId = null;
  }
}

export function getFrames(): Readonly<Snapshot[]> {
  return _frames;
}

export function clearFrames() {
  _frames = [];
}

export function isRecording() {
  return _timerId !== null;
}
