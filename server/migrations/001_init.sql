-- Sky Guardian DDS — Initial Database Schema
-- Migration 001: Core tables

-- ─── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUM types ───────────────────────────────────────────────
CREATE TYPE threat_level   AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE drone_status   AS ENUM ('tracked', 'intercepted', 'lost', 'neutralized');
CREATE TYPE sensor_type    AS ENUM ('RF', 'RADAR', 'OPTIC', 'ACOUSTIC');
CREATE TYPE sensor_status  AS ENUM ('online', 'degraded', 'offline', 'maintenance');
CREATE TYPE incident_status AS ENUM ('open', 'investigating', 'resolved', 'dismissed');
CREATE TYPE user_role      AS ENUM ('admin', 'senior_operator', 'operator', 'analyst', 'viewer');
CREATE TYPE clearance_level AS ENUM ('UNCLASSIFIED', 'SECRET', 'TOP SECRET');
CREATE TYPE mission_status AS ENUM ('planned', 'active', 'completed', 'aborted');
CREATE TYPE mission_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- ─── USERS ────────────────────────────────────────────────────
CREATE TABLE users (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    VARCHAR(20)   UNIQUE NOT NULL,
  name           VARCHAR(100)  NOT NULL,
  email          VARCHAR(200)  UNIQUE NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,
  role           user_role     NOT NULL DEFAULT 'operator',
  clearance      clearance_level NOT NULL DEFAULT 'SECRET',
  status         VARCHAR(20)   NOT NULL DEFAULT 'offline',
  last_active    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── SENSORS ──────────────────────────────────────────────────
CREATE TABLE sensors (
  id           VARCHAR(20)   PRIMARY KEY,
  name         VARCHAR(50)   NOT NULL,
  type         sensor_type   NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  status       sensor_status NOT NULL DEFAULT 'online',
  health       SMALLINT      NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  signal       SMALLINT      NOT NULL DEFAULT 100 CHECK (signal BETWEEN 0 AND 100),
  range_km     SMALLINT      NOT NULL,
  last_ping    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── DRONES ───────────────────────────────────────────────────
CREATE TABLE drones (
  id           VARCHAR(20)      PRIMARY KEY,
  callsign     VARCHAR(50)      NOT NULL,
  model        VARCHAR(100)     NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  altitude_m   INTEGER          NOT NULL DEFAULT 0,
  speed_kmh    DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading_deg  DOUBLE PRECISION NOT NULL DEFAULT 0,
  threat       threat_level     NOT NULL DEFAULT 'low',
  status       drone_status     NOT NULL DEFAULT 'tracked',
  confidence   DOUBLE PRECISION NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
  detected_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  last_seen    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ─── DETECTIONS ───────────────────────────────────────────────
CREATE TABLE detections (
  id           VARCHAR(20)      PRIMARY KEY,
  drone_id     VARCHAR(20)      REFERENCES drones(id) ON DELETE SET NULL,
  sensor_id    VARCHAR(20)      REFERENCES sensors(id) ON DELETE SET NULL,
  callsign     VARCHAR(50)      NOT NULL,
  model        VARCHAR(100)     NOT NULL,
  threat       threat_level     NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  confidence   DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  notes        TEXT,
  timestamp    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ─── INCIDENTS ────────────────────────────────────────────────
CREATE TABLE incidents (
  id           VARCHAR(20)      PRIMARY KEY,
  code         VARCHAR(20)      UNIQUE NOT NULL,
  title        VARCHAR(200)     NOT NULL,
  threat       threat_level     NOT NULL,
  status       incident_status  NOT NULL DEFAULT 'open',
  assignee     VARCHAR(100),
  description  TEXT,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ─── INCIDENT ↔ DETECTION (junction) ──────────────────────────
CREATE TABLE incident_detections (
  incident_id  VARCHAR(20) REFERENCES incidents(id)  ON DELETE CASCADE,
  detection_id VARCHAR(20) REFERENCES detections(id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, detection_id)
);

-- ─── ALERT EVENTS ─────────────────────────────────────────────
CREATE TABLE alert_events (
  id           VARCHAR(20)   PRIMARY KEY,
  level        threat_level  NOT NULL,
  title        VARCHAR(200)  NOT NULL,
  message      TEXT          NOT NULL,
  source       VARCHAR(100)  NOT NULL,
  acknowledged BOOLEAN       NOT NULL DEFAULT FALSE,
  timestamp    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── GEO ZONES ────────────────────────────────────────────────
CREATE TABLE geo_zones (
  id           VARCHAR(20)      PRIMARY KEY,
  name         VARCHAR(100)     NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  radius_m     INTEGER          NOT NULL,
  threat       threat_level     NOT NULL,
  active       BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ─── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE audit_logs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  operator_name VARCHAR(100),
  action        VARCHAR(200) NOT NULL,
  resource      VARCHAR(100),
  resource_id   VARCHAR(50),
  details       JSONB,
  ip_address    INET,
  timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── MISSIONS ─────────────────────────────────────────────────
CREATE TABLE missions (
  id           VARCHAR(20)      PRIMARY KEY,
  code         VARCHAR(20)      UNIQUE NOT NULL,
  name         VARCHAR(200)     NOT NULL,
  status       mission_status   NOT NULL DEFAULT 'planned',
  priority     mission_priority NOT NULL DEFAULT 'medium',
  assignee     VARCHAR(100),
  description  TEXT,
  start_time   TIMESTAMPTZ,
  end_time     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ─── PLAYBOOKS ────────────────────────────────────────────────
CREATE TABLE playbooks (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(200) NOT NULL,
  threat_level threat_level NOT NULL,
  steps        JSONB        NOT NULL DEFAULT '[]',
  active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── CAMERAS ──────────────────────────────────────────────────
CREATE TABLE cameras (
  id           VARCHAR(20)      PRIMARY KEY,
  name         VARCHAR(100)     NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  status       VARCHAR(20)      NOT NULL DEFAULT 'online',
  feed_url     TEXT,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ─── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE notifications (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  message      TEXT         NOT NULL,
  level        VARCHAR(20)  NOT NULL DEFAULT 'info',
  read         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── THREAT INTEL ─────────────────────────────────────────────
CREATE TABLE threat_intel (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title        VARCHAR(200) NOT NULL,
  source       VARCHAR(100) NOT NULL,
  threat_level threat_level NOT NULL,
  summary      TEXT,
  tags         TEXT[],
  verified     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────
CREATE INDEX idx_detections_drone_id   ON detections(drone_id);
CREATE INDEX idx_detections_sensor_id  ON detections(sensor_id);
CREATE INDEX idx_detections_timestamp  ON detections(timestamp DESC);
CREATE INDEX idx_incidents_status      ON incidents(status);
CREATE INDEX idx_incidents_threat      ON incidents(threat);
CREATE INDEX idx_alert_events_timestamp ON alert_events(timestamp DESC);
CREATE INDEX idx_audit_logs_timestamp  ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX idx_drones_status         ON drones(status);
CREATE INDEX idx_drones_threat         ON drones(threat);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);

-- ─── updated_at auto-trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_missions_updated_at
  BEFORE UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_playbooks_updated_at
  BEFORE UPDATE ON playbooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
