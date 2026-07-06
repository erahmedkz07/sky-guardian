import type { Server as HttpServer } from "http";
import { Server as SocketIO } from "socket.io";
import { db } from "../db/client.js";
import { drones, sensors } from "../db/schema.js";
import { eq } from "drizzle-orm";
import "dotenv/config";

let _io: SocketIO | null = null;
export function getSocketServer(): SocketIO | null { return _io; }

// ─── Loiter pattern: keeps a single low-threat drone orbiting near BETTA-01 ───
const LOITER_DRONE_ID    = "DRN-LOW-002";
const LOITER_CENTER      = { lat: 51.09074452700228, lng: 71.41878139211634 }; // BETTA-01
const LOITER_RADIUS_DEG  = 0.0015; // ~150m
let loiterAngle = 0;

async function tickLoiter() {
  loiterAngle = (loiterAngle + 0.12) % (2 * Math.PI);
  const lat = LOITER_CENTER.lat + LOITER_RADIUS_DEG * Math.sin(loiterAngle);
  const lng = LOITER_CENTER.lng + LOITER_RADIUS_DEG * Math.cos(loiterAngle) * 1.4;
  const headingDeg = ((loiterAngle * 180) / Math.PI + 90) % 360;

  try {
    await db.update(drones)
      .set({ lat, lng, headingDeg, lastSeen: new Date() })
      .where(eq(drones.id, LOITER_DRONE_ID));
  } catch {
    // skip on transient DB error
  }
}

// ─── Sensor heartbeat: keeps online sensors' lastPing fresh (~1 min cadence) ───
async function tickSensorHeartbeat() {
  try {
    await db.update(sensors)
      .set({ lastPing: new Date() })
      .where(eq(sensors.status, "online"));
  } catch {
    // skip on transient DB error
  }
}

export function setupWebSocket(httpServer: HttpServer) {
  const io = new SocketIO(httpServer, {
    cors: {
      origin: ["http://localhost:5173","http://localhost:8080","http://localhost:8081","http://localhost:8082",
               process.env.FRONTEND_URL ?? "http://localhost:5173"],
      credentials: true,
    },
  });

  _io = io;

  io.on("connection", (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`[ws] client disconnected: ${socket.id}`);
    });
  });

  // Broadcast drone positions every 3 seconds; loiter drone gets nudged first
  setInterval(async () => {
    if (io.engine.clientsCount === 0) return;
    await tickLoiter();
    try {
      const rows = await db.select({
        id:         drones.id,
        callsign:   drones.callsign,
        model:      drones.model,
        lat:        drones.lat,
        lng:        drones.lng,
        altitudeM:  drones.altitudeM,
        speedKmh:   drones.speedKmh,
        headingDeg: drones.headingDeg,
        threat:     drones.threat,
        status:     drones.status,
        confidence: drones.confidence,
        detectedAt: drones.detectedAt,
      }).from(drones);

      const payload = rows.map((d) => ({
        id:         d.id,
        callsign:   d.callsign,
        model:      d.model,
        lat:        d.lat,
        lng:        d.lng,
        altitude:   d.altitudeM,
        speed:      d.speedKmh,
        heading:    d.headingDeg,
        threat:     d.threat,
        status:     d.status,
        confidence: d.confidence,
        detectedAt: d.detectedAt,
      }));

      io.emit("drones:tick", payload);
    } catch {
      // DB might be briefly unavailable, skip tick
    }
  }, 3000);

  // Refresh online sensors' lastPing and broadcast every 60 seconds
  async function tickAndBroadcastSensors() {
    await tickSensorHeartbeat();
    try {
      const rows = await db.select({
        id:       sensors.id,
        name:     sensors.name,
        type:     sensors.type,
        lat:      sensors.lat,
        lng:      sensors.lng,
        status:   sensors.status,
        health:   sensors.health,
        signal:   sensors.signal,
        rangeKm:  sensors.rangeKm,
        lastPing: sensors.lastPing,
        config:   sensors.config,
      }).from(sensors);

      const payload = rows.map((s) => ({
        id:       s.id,
        name:     s.name,
        type:     s.type,
        lat:      s.lat,
        lng:      s.lng,
        status:   s.status,
        health:   s.health,
        signal:   s.signal,
        range:    s.rangeKm,
        lastPing: s.lastPing,
        config:   s.config ?? {},
      }));

      io.emit("sensors:tick", payload);
    } catch {
      // DB might be briefly unavailable, skip tick
    }
  }

  tickAndBroadcastSensors(); // immediate heartbeat on boot so lastPing reads "just now"
  setInterval(tickAndBroadcastSensors, 60_000);

  return io;
}
