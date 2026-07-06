import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { setupWebSocket } from "./ws/droneStream.js";

import authRouter      from "./routes/auth.js";
import dronesRouter    from "./routes/drones.js";
import sensorsRouter   from "./routes/sensors.js";
import detectionsRouter from "./routes/detections.js";
import incidentsRouter from "./routes/incidents.js";
import alertsRouter    from "./routes/alerts.js";
import geoZonesRouter  from "./routes/geoZones.js";
import teamRouter      from "./routes/team.js";
import missionsRouter  from "./routes/missions.js";
import auditRouter     from "./routes/audit.js";
import playbooksRouter from "./routes/playbooks.js";
import camerasRouter   from "./routes/cameras.js";
import threatIntelRouter from "./routes/threatIntel.js";
import profileRouter   from "./routes/profile.js";
import analyticsRouter from "./routes/analytics.js";
import reportsRouter      from "./routes/reports.js";
import statsRouter        from "./routes/stats.js";
import simulationsRouter  from "./routes/simulations.js";
import aiEngineRouter     from "./routes/aiEngine.js";
import twoFactorRouter    from "./routes/twoFactor.js";
import telegramRouter     from "./routes/telegram.js";
import hardwareRouter     from "./routes/hardware.js";
import { startBot }       from "./bot/index.js";
import { periodicEvaluate, setSocketServer } from "./services/aiEngine.js";

const app  = express();
const PORT = Number(process.env.PORT ?? 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      process.env.FRONTEND_URL ?? "http://localhost:5173",
      "http://localhost:5173",
      "http://localhost:8080",
      "http://localhost:8081",
      "http://localhost:8082",
    ];
    if (!origin || allowed.includes(origin)) cb(null, true);
    else cb(new Error("CORS: origin not allowed"));
  },
  credentials: true,
}));
app.use(express.json());

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// ─── Rate limiting ────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  message: { error: "Too many login attempts, try again in 15 minutes." },
});

app.use("/api/", globalLimiter);
app.use("/api/auth/login", authLimiter);

// ─── Static uploads ───────────────────────────────────────────
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

// ─── Health check ─────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), service: "sky-guardian-api" });
});

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/auth",        authRouter);
app.use("/api/auth/2fa",   twoFactorRouter);
app.use("/api/drones",      dronesRouter);
app.use("/api/sensors",     sensorsRouter);
app.use("/api/detections",  detectionsRouter);
app.use("/api/incidents",   incidentsRouter);
app.use("/api/alerts",      alertsRouter);
app.use("/api/geo-zones",   geoZonesRouter);
app.use("/api/team",        teamRouter);
app.use("/api/missions",    missionsRouter);
app.use("/api/audit",       auditRouter);
app.use("/api/playbooks",   playbooksRouter);
app.use("/api/cameras",     camerasRouter);
app.use("/api/threat-intel",threatIntelRouter);
app.use("/api/profile",     profileRouter);
app.use("/api/analytics",   analyticsRouter);
app.use("/api/reports",      reportsRouter);
app.use("/api/stats",        statsRouter);
app.use("/api/simulations",  simulationsRouter);
app.use("/api/ai-engine",    aiEngineRouter);
app.use("/api/telegram",     telegramRouter);
app.use("/api/hardware",     hardwareRouter);

// ─── 404 handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ─── Start ────────────────────────────────────────────────────
const httpServer = createServer(app);
const io = setupWebSocket(httpServer);
setSocketServer(io);

// AI periodic evaluation every 30s
setInterval(() => { periodicEvaluate().catch(() => {}); }, 30_000);

httpServer.listen(PORT, () => {
  console.log(`\n🛡  Sky Guardian API running on http://localhost:${PORT}`);
  console.log(`   WebSocket enabled (Socket.io)`);
  console.log(`   AI Engine started (advisory mode)`);
  console.log(`   DB: ${process.env.DATABASE_URL?.replace(/:.*@/, ":***@")}\n`);
  startBot();
});
