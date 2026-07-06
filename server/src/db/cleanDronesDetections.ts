/**
 * Cleanup script:
 * - Leaves exactly 4 drones (one per threat level: low/medium/high/critical), all tracked
 * - Leaves exactly 3 detections (one low, one medium, one high)
 * - Clears all alert_events
 * - Sets AI to passive mode (zero auto-generation)
 */
import { db } from "./client.js";
import { drones, detections, alertEvents, incidentDetections, aiSettings } from "./schema.js";
import { sql, notInArray } from "drizzle-orm";
import "dotenv/config";

const CENTER = { lat: 51.180, lng: 71.446 };

async function main() {
  console.log("\n🧹  Cleanup: Drones & Detections\n");

  // ─── 1. Clear everything and insert 4 clean drones ──────────────────────
  console.log("  → Replacing drones with 4 clean entries (one per threat level)...");
  await db.delete(drones);

  await db.insert(drones).values([
    {
      id: "DRN-LOW-001", callsign: "GHOST-22", model: "DJI Mavic 3",
      lat: CENTER.lat - 0.08, lng: CENTER.lng - 0.12,
      altitudeM: 120, speedKmh: 45, headingDeg: 90,
      threat: "low", status: "tracked", confidence: 0.82,
      detectedAt: new Date(Date.now() - 3600_000),
      lastSeen:   new Date(),
    },
    {
      id: "DRN-MED-001", callsign: "VIPER-44", model: "Autel EVO II",
      lat: CENTER.lat + 0.06, lng: CENTER.lng + 0.10,
      altitudeM: 310, speedKmh: 78, headingDeg: 200,
      threat: "medium", status: "tracked", confidence: 0.76,
      detectedAt: new Date(Date.now() - 2400_000),
      lastSeen:   new Date(),
    },
    {
      id: "DRN-HGH-001", callsign: "REAPER-77", model: "Bayraktar TB2",
      lat: CENTER.lat + 0.14, lng: CENTER.lng - 0.08,
      altitudeM: 650, speedKmh: 130, headingDeg: 315,
      threat: "high", status: "tracked", confidence: 0.91,
      detectedAt: new Date(Date.now() - 1800_000),
      lastSeen:   new Date(),
    },
    {
      id: "DRN-CRT-001", callsign: "WRAITH-99", model: "Shahed-136",
      lat: CENTER.lat - 0.15, lng: CENTER.lng + 0.18,
      altitudeM: 900, speedKmh: 180, headingDeg: 45,
      threat: "critical", status: "tracked", confidence: 0.97,
      detectedAt: new Date(Date.now() - 900_000),
      lastSeen:   new Date(),
    },
  ]);
  console.log("     ✓ 4 drones inserted");

  // ─── 2. Keep only 3 detections (one per level: low/medium/high) ─────────
  console.log("  → Resetting detections to 3 entries (one per level)...");
  await db.delete(incidentDetections);
  await db.delete(detections);

  const now = new Date();
  await db.insert(detections).values([
    {
      id: "DET-CLEAN-001", droneId: "DRN-LOW-001", sensorId: "SNS-001",
      callsign: "GHOST-22", model: "DJI Mavic 3", threat: "low",
      lat: CENTER.lat - 0.08, lng: CENTER.lng - 0.12,
      confidence: 0.82, notes: null,
      timestamp: new Date(now.getTime() - 3600_000),
      createdAt: new Date(now.getTime() - 3600_000),
    },
    {
      id: "DET-CLEAN-002", droneId: "DRN-MED-001", sensorId: "SNS-002",
      callsign: "VIPER-44", model: "Autel EVO II", threat: "medium",
      lat: CENTER.lat + 0.06, lng: CENTER.lng + 0.10,
      confidence: 0.76, notes: null,
      timestamp: new Date(now.getTime() - 2400_000),
      createdAt: new Date(now.getTime() - 2400_000),
    },
    {
      id: "DET-CLEAN-003", droneId: "DRN-HGH-001", sensorId: "SNS-003",
      callsign: "REAPER-77", model: "Bayraktar TB2", threat: "high",
      lat: CENTER.lat + 0.14, lng: CENTER.lng - 0.08,
      confidence: 0.91, notes: null,
      timestamp: new Date(now.getTime() - 1800_000),
      createdAt: new Date(now.getTime() - 1800_000),
    },
  ]);
  console.log("     ✓ 3 detections inserted (low / medium / high)");

  // ─── 3. Clear alert_events completely ───────────────────────────────────
  console.log("  → Clearing alert_events...");
  await db.delete(alertEvents);
  console.log("     ✓ alert_events cleared");

  // ─── 4. Set AI to passive (zero auto-generation) ────────────────────────
  console.log("  → Setting AI to passive mode...");
  await db.execute(sql`
    UPDATE ai_settings
    SET op_mode       = 'passive',
        auto_incident = false,
        auto_ack      = false,
        auto_playbook = false,
        updated_at    = NOW()
    WHERE id = 1
  `);
  console.log("     ✓ AI mode = passive (no auto-generation)");

  console.log(`
✅  Done!

  Drones  : 4 (low / medium / high / critical) — all tracked, static positions
  Detections : 3 (low / medium / high)
  Alert events : 0
  AI mode : passive (no automatic generation)
`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
