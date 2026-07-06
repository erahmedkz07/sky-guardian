import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  smallint,
  integer,
  bigint,
  doublePrecision,
  boolean,
  jsonb,
  inet,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────
export const threatLevelEnum    = pgEnum("threat_level",    ["low", "medium", "high", "critical"]);
export const droneStatusEnum    = pgEnum("drone_status",    ["tracked", "intercepted", "lost", "neutralized"]);
export const sensorTypeEnum     = pgEnum("sensor_type",     ["RF", "RADAR", "OPTIC", "ACOUSTIC"]);
export const sensorStatusEnum   = pgEnum("sensor_status",   ["online", "degraded", "offline", "maintenance"]);
export const incidentStatusEnum = pgEnum("incident_status", ["open", "investigating", "resolved", "dismissed"]);
export const userRoleEnum       = pgEnum("user_role",       ["admin", "senior_operator", "operator", "analyst", "viewer"]);
export const clearanceLevelEnum = pgEnum("clearance_level", ["UNCLASSIFIED", "SECRET", "TOP SECRET"]);
export const missionStatusEnum  = pgEnum("mission_status",  ["planned", "active", "completed", "aborted"]);
export const missionPriorityEnum= pgEnum("mission_priority",["low", "medium", "high", "critical"]);

// ─── Users ────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  operatorId:   varchar("operator_id", { length: 20 }).unique().notNull(),
  name:         varchar("name", { length: 100 }).notNull(),
  email:        varchar("email", { length: 200 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role:         userRoleEnum("role").notNull().default("operator"),
  clearance:    clearanceLevelEnum("clearance").notNull().default("SECRET"),
  status:       varchar("status", { length: 20 }).notNull().default("offline"),
  lastActive:   timestamp("last_active", { withTimezone: true }),
  avatarUrl:    varchar("avatar_url", { length: 500 }),
  totpSecret:        varchar("totp_secret",  { length: 64 }),
  totpEnabled:       boolean("totp_enabled").notNull().default(false),
  telegramChatId:    bigint("telegram_chat_id", { mode: "bigint" }).unique(),
  loginAttempts:     integer("login_attempts").notNull().default(0),
  lockedUntil:       timestamp("locked_until", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Sensors ──────────────────────────────────────────────────
export const sensors = pgTable("sensors", {
  id:        varchar("id", { length: 20 }).primaryKey(),
  name:      varchar("name", { length: 50 }).notNull(),
  type:      sensorTypeEnum("type").notNull(),
  lat:       doublePrecision("lat").notNull(),
  lng:       doublePrecision("lng").notNull(),
  status:    sensorStatusEnum("status").notNull().default("online"),
  health:    smallint("health").notNull().default(100),
  signal:    smallint("signal").notNull().default(100),
  rangeKm:   smallint("range_km").notNull(),
  lastPing:  timestamp("last_ping", { withTimezone: true }).notNull().defaultNow(),
  config:    jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Drones ───────────────────────────────────────────────────
export const drones = pgTable("drones", {
  id:          varchar("id", { length: 20 }).primaryKey(),
  callsign:    varchar("callsign", { length: 50 }).notNull(),
  model:       varchar("model", { length: 100 }).notNull(),
  lat:         doublePrecision("lat").notNull(),
  lng:         doublePrecision("lng").notNull(),
  altitudeM:   integer("altitude_m").notNull().default(0),
  speedKmh:    doublePrecision("speed_kmh").notNull().default(0),
  headingDeg:  doublePrecision("heading_deg").notNull().default(0),
  threat:      threatLevelEnum("threat").notNull().default("low"),
  status:      droneStatusEnum("status").notNull().default("tracked"),
  confidence:  doublePrecision("confidence").notNull().default(0.8),
  detectedAt:  timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeen:    timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Detections ───────────────────────────────────────────────
export const detections = pgTable("detections", {
  id:         varchar("id", { length: 20 }).primaryKey(),
  droneId:    varchar("drone_id", { length: 20 }).references(() => drones.id, { onDelete: "set null" }),
  sensorId:   varchar("sensor_id", { length: 20 }).references(() => sensors.id, { onDelete: "set null" }),
  callsign:   varchar("callsign", { length: 50 }).notNull(),
  model:      varchar("model", { length: 100 }).notNull(),
  threat:     threatLevelEnum("threat").notNull(),
  lat:        doublePrecision("lat").notNull(),
  lng:        doublePrecision("lng").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  notes:      text("notes"),
  timestamp:  timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Incidents ────────────────────────────────────────────────
export const incidents = pgTable("incidents", {
  id:          varchar("id", { length: 20 }).primaryKey(),
  code:        varchar("code", { length: 20 }).unique().notNull(),
  title:       varchar("title", { length: 200 }).notNull(),
  threat:      threatLevelEnum("threat").notNull(),
  status:      incidentStatusEnum("status").notNull().default("open"),
  assignee:    varchar("assignee", { length: 100 }),
  description: text("description"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Incident ↔ Detection (junction) ──────────────────────────
export const incidentDetections = pgTable("incident_detections", {
  incidentId:  varchar("incident_id", { length: 20 }).references(() => incidents.id, { onDelete: "cascade" }).notNull(),
  detectionId: varchar("detection_id", { length: 20 }).references(() => detections.id, { onDelete: "cascade" }).notNull(),
}, (t) => [primaryKey({ columns: [t.incidentId, t.detectionId] })]);

// ─── Alert Events ─────────────────────────────────────────────
export const alertEvents = pgTable("alert_events", {
  id:           varchar("id", { length: 20 }).primaryKey(),
  level:        threatLevelEnum("level").notNull(),
  title:        varchar("title", { length: 200 }).notNull(),
  message:      text("message").notNull(),
  source:       varchar("source", { length: 100 }).notNull(),
  acknowledged: boolean("acknowledged").notNull().default(false),
  timestamp:    timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Geo Zones ────────────────────────────────────────────────
export const geoZones = pgTable("geo_zones", {
  id:        varchar("id", { length: 20 }).primaryKey(),
  name:      varchar("name", { length: 100 }).notNull(),
  lat:       doublePrecision("lat").notNull(),
  lng:       doublePrecision("lng").notNull(),
  radiusM:   integer("radius_m").notNull(),
  threat:    threatLevelEnum("threat").notNull(),
  active:    boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Audit Logs ───────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  operatorName: varchar("operator_name", { length: 100 }),
  action:       varchar("action", { length: 200 }).notNull(),
  resource:     varchar("resource", { length: 100 }),
  resourceId:   varchar("resource_id", { length: 50 }),
  details:      jsonb("details"),
  ipAddress:    inet("ip_address"),
  timestamp:    timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Missions ─────────────────────────────────────────────────
export const missions = pgTable("missions", {
  id:          varchar("id", { length: 20 }).primaryKey(),
  code:        varchar("code", { length: 20 }).unique().notNull(),
  name:        varchar("name", { length: 200 }).notNull(),
  status:      missionStatusEnum("status").notNull().default("planned"),
  priority:    missionPriorityEnum("priority").notNull().default("medium"),
  assignee:    varchar("assignee", { length: 100 }),
  description: text("description"),
  startTime:   timestamp("start_time", { withTimezone: true }),
  endTime:     timestamp("end_time", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Playbooks ────────────────────────────────────────────────
export const playbooks = pgTable("playbooks", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        varchar("name", { length: 200 }).notNull(),
  threatLevel: threatLevelEnum("threat_level").notNull(),
  steps:       jsonb("steps").notNull().default([]),
  active:      boolean("active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Cameras ──────────────────────────────────────────────────
export const cameras = pgTable("cameras", {
  id:        varchar("id", { length: 20 }).primaryKey(),
  name:      varchar("name", { length: 100 }).notNull(),
  lat:       doublePrecision("lat").notNull(),
  lng:       doublePrecision("lng").notNull(),
  status:    varchar("status", { length: 20 }).notNull().default("online"),
  feedUrl:   text("feed_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Notifications ────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  title:     varchar("title", { length: 200 }).notNull(),
  message:   text("message").notNull(),
  level:     varchar("level", { length: 20 }).notNull().default("info"),
  read:      boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Threat Intel ─────────────────────────────────────────────
export const threatIntel = pgTable("threat_intel", {
  id:          uuid("id").primaryKey().defaultRandom(),
  title:       varchar("title", { length: 200 }).notNull(),
  source:      varchar("source", { length: 100 }).notNull(),
  threatLevel: threatLevelEnum("threat_level").notNull(),
  summary:     text("summary"),
  verified:    boolean("verified").notNull().default(false),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Simulation Results ───────────────────────────────────────
export const simulationResults = pgTable("simulation_results", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  operatorName: varchar("operator_name", { length: 100 }),
  scenarioId:   varchar("scenario_id", { length: 20 }).notNull(),
  scenarioName: varchar("scenario_name", { length: 200 }).notNull(),
  difficulty:   varchar("difficulty", { length: 20 }).notNull(),
  score:        smallint("score").notNull(),
  neutralized:  smallint("neutralized").notNull(),
  threats:      smallint("threats").notNull(),
  elapsedS:     integer("elapsed_s").notNull(),
  aborted:      boolean("aborted").notNull().default(false),
  completedAt:  timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── AI Settings (single-row config, id always 1) ────────────
export const aiSettings = pgTable("ai_settings", {
  id:                  integer("id").primaryKey().default(1),
  opMode:              varchar("op_mode", { length: 20 }).notNull().default("advisory"),
  autoIncident:        boolean("auto_incident").notNull().default(true),
  autoAck:             boolean("auto_ack").notNull().default(false),
  autoPlaybook:        boolean("auto_playbook").notNull().default(false),
  globalMinConfidence: integer("global_min_confidence").notNull().default(60),
  modelSettings:       jsonb("model_settings").notNull().default({}),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── AI Pending Actions ───────────────────────────────────────
export const aiPendingActions = pgTable("ai_pending_actions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  actionType:  varchar("action_type", { length: 50 }).notNull(),
  payload:     jsonb("payload").notNull().default({}),
  reason:      text("reason").notNull(),
  confidence:  integer("confidence").notNull().default(0),
  status:      varchar("status", { length: 20 }).notNull().default("pending"),
  resolvedBy:  varchar("resolved_by", { length: 100 }),
  resolvedAt:  timestamp("resolved_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Telegram Auth Codes ──────────────────────────────────────
export const telegramAuthCodes = pgTable("telegram_auth_codes", {
  code:      varchar("code", { length: 12 }).primaryKey(),
  chatId:    bigint("chat_id", { mode: "bigint" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Inferred Types ───────────────────────────────────────────
export type User         = typeof users.$inferSelect;
export type NewUser      = typeof users.$inferInsert;
export type Sensor       = typeof sensors.$inferSelect;
export type NewSensor    = typeof sensors.$inferInsert;
export type Drone        = typeof drones.$inferSelect;
export type NewDrone     = typeof drones.$inferInsert;
export type Detection    = typeof detections.$inferSelect;
export type NewDetection = typeof detections.$inferInsert;
export type Incident     = typeof incidents.$inferSelect;
export type NewIncident  = typeof incidents.$inferInsert;
export type AlertEvent   = typeof alertEvents.$inferSelect;
export type GeoZone      = typeof geoZones.$inferSelect;
export type AuditLog     = typeof auditLogs.$inferSelect;
export type Mission      = typeof missions.$inferSelect;
export type Playbook     = typeof playbooks.$inferSelect;
export type Camera       = typeof cameras.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ThreatIntel        = typeof threatIntel.$inferSelect;
export type SimulationResult   = typeof simulationResults.$inferSelect;
export type NewSimulationResult= typeof simulationResults.$inferInsert;
export type AiSettings         = typeof aiSettings.$inferSelect;
export type AiPendingAction    = typeof aiPendingActions.$inferSelect;
export type TelegramAuthCode   = typeof telegramAuthCodes.$inferSelect;
