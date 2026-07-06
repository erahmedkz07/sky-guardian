/**
 * Full reset script:
 * - Clears: detections, incidents, missions, alert_events, audit_logs, notifications
 * - Disables AI auto-incident to stop infinite generation
 * - Creates 1 open medium incident
 * - Adds 35 fresh detections (5/day × 7 days) for analytics charts
 * - Creates one account per role (5 roles total)
 */
import { db } from "./client.js";
import {
  users, drones, detections, incidents, incidentDetections,
  alertEvents, missions, auditLogs, notifications, aiSettings,
} from "./schema.js";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import "dotenv/config";

const CENTER = { lat: 51.180, lng: 71.446 };
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

function daysAgo(days: number): Date {
  const d = new Date();
  d.setTime(d.getTime() - days * 86_400_000 - randInt(0, 3_600_000));
  return d;
}

async function main() {
  console.log("\n🧹  Sky Guardian — Full Reset\n");

  // ─── 1. Clear volatile tables ───────────────────────────────────────────
  console.log("  → Clearing incident_detections...");
  await db.delete(incidentDetections);

  console.log("  → Clearing incidents...");
  await db.delete(incidents);

  console.log("  → Clearing detections...");
  await db.delete(detections);

  console.log("  → Clearing missions...");
  await db.delete(missions);

  console.log("  → Clearing alert_events (notifications)...");
  await db.delete(alertEvents);

  console.log("  → Clearing notifications...");
  await db.delete(notifications);

  console.log("  → Clearing audit_logs...");
  await db.delete(auditLogs);

  // ─── 2. Disable AI auto-incident (stops infinite generation) ────────────
  console.log("  → Disabling AI auto-incident...");
  await db.execute(sql`
    INSERT INTO ai_settings (id, op_mode, auto_incident, auto_ack, auto_playbook, global_min_confidence)
    VALUES (1, 'advisory', false, false, false, 60)
    ON CONFLICT (id) DO UPDATE
      SET auto_incident = false,
          op_mode       = 'advisory',
          updated_at    = NOW()
  `);

  // ─── 3. Create 1 open medium incident ───────────────────────────────────
  console.log("  → Creating demo incident (open / medium)...");
  await db.insert(incidents).values({
    id:          "INC-DEMO-001",
    code:        "INC-DEMO-001",
    title:       "Несанкционированный дрон над охраняемой зоной",
    threat:      "medium",
    status:      "open",
    assignee:    "Syrym Argyn",
    description: "Обнаружен дрон неизвестного происхождения над периметром охраняемого объекта. Требуется расследование.",
  });

  // ─── 4. Fresh detections for analytics (5/day × 7 days) ────────────────
  console.log("  → Seeding 35 fresh detections (7 days) for analytics...");
  const droneRows = await db.select({
    id: drones.id, callsign: drones.callsign, model: drones.model, threat: drones.threat,
  }).from(drones);

  const sensorIds   = ["SNS-001", "SNS-002", "SNS-003", "SNS-004", "SNS-005", "SNS-006"];
  const threatLevels = ["low", "low", "medium", "medium", "high", "critical"] as const;
  const droneModels  = ["DJI Mavic 3", "Autel EVO II", "Skydio X10", "Bayraktar TB2", "Shahed-136", "Switchblade 600", "Quantum Vector", "Parrot Anafi"];
  const callsigns    = ["RAVEN", "VIPER", "GHOST", "WRAITH", "PHANTOM", "REAPER", "HORNET", "FALCON"];

  const detectionRows = Array.from({ length: 35 }, (_, i) => {
    const dayBack = 6 - Math.floor(i / 5); // day 6..0
    const ts      = daysAgo(dayBack);
    const drone   = droneRows[i % Math.max(droneRows.length, 1)] ?? null;
    const threat  = threatLevels[Math.floor(Math.random() * threatLevels.length)];
    const model   = drone?.model ?? droneModels[Math.floor(Math.random() * droneModels.length)];
    const cs      = drone?.callsign ?? `${callsigns[Math.floor(Math.random() * callsigns.length)]}-${randInt(10,99)}`;
    return {
      id:         `DET-NEW-${String(i + 1).padStart(4, "0")}`,
      droneId:    drone?.id ?? null,
      sensorId:   sensorIds[randInt(0, 5)],
      callsign:   cs,
      model,
      threat,
      lat:        CENTER.lat + rand(-0.18, 0.18),
      lng:        CENTER.lng + rand(-0.25, 0.25),
      confidence: rand(0.60, 0.99),
      notes:      null,
      timestamp:  ts,
      createdAt:  ts,
    };
  });

  await db.insert(detections).values(detectionRows);

  // ─── 5. Create one account per role ─────────────────────────────────────
  console.log("  → Creating role accounts...");
  const roleUsers = [
    { operatorId: "OP-00002", name: "Алексей Ким",     email: "senior@dds.kz",   role: "senior_operator" as const, clearance: "TOP SECRET" as const,  password: "senior2026" },
    { operatorId: "OP-00003", name: "Дана Сейткали",   email: "operator@dds.kz", role: "operator"        as const, clearance: "SECRET"     as const,  password: "operator2026" },
    { operatorId: "OP-00004", name: "Марат Джаксыбек", email: "analyst@dds.kz",  role: "analyst"         as const, clearance: "SECRET"     as const,  password: "analyst2026" },
    { operatorId: "OP-00005", name: "Айгерим Бекова",  email: "viewer@dds.kz",   role: "viewer"          as const, clearance: "UNCLASSIFIED" as const, password: "viewer2026" },
  ];

  for (const u of roleUsers) {
    const hash = await bcrypt.hash(u.password, 10);
    await db.insert(users).values({
      operatorId:   u.operatorId,
      name:         u.name,
      email:        u.email,
      passwordHash: hash,
      role:         u.role,
      clearance:    u.clearance,
      status:       "offline",
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: u.name, role: u.role, clearance: u.clearance },
    });
    console.log(`     ✓ ${u.role.padEnd(20)} ${u.email} / ${u.password}`);
  }

  // ─── 6. Update admin avatarUrl in DB if missing ─────────────────────────
  console.log("  → Ensuring admin avatarUrl is set...");
  const [admin] = await db.select({ id: users.id, avatarUrl: users.avatarUrl })
    .from(users).where(sql`email = 'cnb@dds.kz'`).limit(1);
  if (admin && !admin.avatarUrl) {
    await db.execute(sql`
      UPDATE users SET avatar_url = ${`http://localhost:3001/uploads/avatars/${admin.id}.jpg`}
      WHERE id = ${admin.id}
    `);
    console.log(`     ✓ avatarUrl set for admin`);
  } else {
    console.log(`     ✓ admin avatarUrl already set`);
  }

  console.log(`
✅  Reset complete!

  Accounts:
  ┌─────────────────────┬──────────────────────┬───────────────┐
  │ Role                │ Email                │ Password      │
  ├─────────────────────┼──────────────────────┼───────────────┤
  │ admin               │ cnb@dds.kz           │ cnb2026       │
  │ senior_operator     │ senior@dds.kz        │ senior2026    │
  │ operator            │ operator@dds.kz      │ operator2026  │
  │ analyst             │ analyst@dds.kz       │ analyst2026   │
  │ viewer              │ viewer@dds.kz        │ viewer2026    │
  └─────────────────────┴──────────────────────┴───────────────┘

  Data:
  - Incidents  : 1 (open / medium)
  - Detections : 35 (5/day × 7 days) — feeds Analytics charts
  - Missions   : 0 (clean)
  - Alerts     : 0 (clean)
  - Audit logs : 0 (clean)
  - AI autoIncident: DISABLED
`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
