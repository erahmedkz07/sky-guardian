import { Router } from "express";
import { db } from "../db/client.js";
import { detections, incidents, auditLogs, users } from "../db/schema.js";
import { eq, count, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();
router.use(requireAuth);

// ─── Multer: avatar upload ─────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve("uploads/avatars");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req: AuthRequest, _file, cb) => {
    const ext = path.extname(_file.originalname).toLowerCase() || ".jpg";
    cb(null, `${(req as AuthRequest).user!.userId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

// GET /api/profile/stats
router.get("/stats", async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select({
      id:         users.id,
      operatorId: users.operatorId,
      name:       users.name,
      email:      users.email,
      role:       users.role,
      clearance:  users.clearance,
      status:     users.status,
      lastActive: users.lastActive,
      avatarUrl:  users.avatarUrl,
      createdAt:  users.createdAt,
    }).from(users).where(eq(users.id, req.user!.userId)).limit(1);

    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const [{ total: totalDetections }] = await db.select({ total: count() }).from(detections);

    const [{ total: assignedIncidents }] = await db
      .select({ total: count() }).from(incidents)
      .where(eq(incidents.assignee, user.name));

    const [{ total: closedIncidents }] = await db
      .select({ total: count() }).from(incidents)
      .where(sql`${incidents.assignee} = ${user.name} AND ${incidents.status} IN ('resolved', 'dismissed')`);

    const [{ total: auditActions }] = await db
      .select({ total: count() }).from(auditLogs)
      .where(eq(auditLogs.userId, user.id));

    res.json({
      user,
      stats: {
        totalDetections:   Number(totalDetections),
        assignedIncidents: Number(assignedIncidents),
        closedIncidents:   Number(closedIncidents),
        auditActions:      Number(auditActions),
      },
    });
  } catch (err) {
    console.error("[profile/stats]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/profile — update display name
router.patch("/", async (req: AuthRequest, res) => {
  const { name } = req.body as { name?: string };
  if (!name || name.trim().length < 2) {
    res.status(400).json({ error: "Name must be at least 2 characters" });
    return;
  }
  try {
    const [updated] = await db
      .update(users)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(users.id, req.user!.userId))
      .returning({ name: users.name });

    res.json({ name: updated.name });
  } catch (err) {
    console.error("[profile/update]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/profile/avatar
router.post("/avatar", upload.single("avatar"), async (req: AuthRequest, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const host = `${req.protocol}://${req.get("host")}`;
  const avatarUrl = `${host}/uploads/avatars/${req.file.filename}`;

  try {
    await db.update(users)
      .set({ avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, req.user!.userId));

    res.json({ avatarUrl });
  } catch (err) {
    console.error("[profile/avatar]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
