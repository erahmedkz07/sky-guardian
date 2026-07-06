/**
 * Fix script:
 * - Clears stale ai_pending_actions
 * - Reseeds 35 analytics detections spread over 7 days
 *   (does NOT touch the 3 clean demo detections: DET-CLEAN-*)
 */
import { db } from "./client.js";
import { detections, aiPendingActions } from "./schema.js";
import { notInArray } from "drizzle-orm";
import "dotenv/config";

const CENTER = { lat: 51.180, lng: 71.446 };
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
function daysAgo(days: number, jitterMs = 3_600_000): Date {
  return new Date(Date.now() - days * 86_400_000 - randInt(0, jitterMs));
}

const THREAT_LEVELS = ["low", "medium", "high", "critical"] as const;
const DRONE_MAP: Record<string, string> = {
  low: "DRN-LOW-001", medium: "DRN-MED-001", high: "DRN-HGH-001", critical: "DRN-CRT-001",
};
const CALLSIGNS: Record<string, string> = {
  low: "GHOST-22", medium: "VIPER-44", high: "REAPER-77", critical: "WRAITH-99",
};
const MODELS: Record<string, string> = {
  low: "DJI Mavic 3", medium: "Autel EVO II", high: "Bayraktar TB2", critical: "Shahed-136",
};
const SENSORS = ["SNS-001", "SNS-002", "SNS-003", "SNS-004", "SNS-005"];

async function main() {
  console.log("\n🔧  Fix: Analytics detections + pending actions\n");

  // 1. Clear stale pending AI actions
  const deleted = await db.delete(aiPendingActions).returning({ id: aiPendingActions.id });
  console.log(`  → Cleared ${deleted.length} stale ai_pending_actions`);

  // 2. Delete old analytics detections (keep DET-CLEAN-*)
  const KEEP = ["DET-CLEAN-001", "DET-CLEAN-002", "DET-CLEAN-003"];
  const removed = await db.delete(detections)
    .where(notInArray(detections.id, KEEP))
    .returning({ id: detections.id });
  console.log(`  → Removed ${removed.length} old analytics detections`);

  // 3. Seed 35 new detections spread over 7 days (5 per day)
  const rows = [];
  let counter = 1;
  for (let day = 7; day >= 1; day--) {
    for (let slot = 0; slot < 5; slot++) {
      const threat = THREAT_LEVELS[randInt(0, 3)];
      const ts = daysAgo(day, 10_800_000);
      const id = `DET-HIST-${String(counter).padStart(3, "0")}`;
      rows.push({
        id,
        droneId:  DRONE_MAP[threat],
        sensorId: SENSORS[randInt(0, 4)],
        callsign: CALLSIGNS[threat],
        model:    MODELS[threat],
        threat,
        lat: CENTER.lat + rand(-0.25, 0.25),
        lng: CENTER.lng + rand(-0.25, 0.25),
        confidence: Math.round(rand(0.60, 0.99) * 100) / 100,
        notes: null,
        timestamp: ts,
        createdAt: ts,
      });
      counter++;
    }
  }
  await db.insert(detections).values(rows);
  console.log(`  → Inserted ${rows.length} analytics detections (5/day × 7 days)`);

  console.log("\n✅  Done!\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
