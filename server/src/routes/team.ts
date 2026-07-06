import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db/client.js";
import { users, auditLogs } from "../db/schema.js";
import { eq, ne } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/team
router.get("/", async (req: AuthRequest, res) => {
  try {
    const rows = await db.select({
      id:         users.id,
      operatorId: users.operatorId,
      name:       users.name,
      email:      users.email,
      role:       users.role,
      clearance:  users.clearance,
      status:     users.status,
      lastActive: users.lastActive,
      createdAt:  users.createdAt,
      avatarUrl:  users.avatarUrl,
    }).from(users).orderBy(users.name);

    res.json(rows);
  } catch (err) {
    console.error("[team/list]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const InviteSchema = z.object({
  name:      z.string().min(2, "Name required"),
  email:     z.string().email("Invalid email"),
  role:      z.enum(["admin", "senior_operator", "operator", "analyst", "viewer"]),
  clearance: z.enum(["UNCLASSIFIED", "SECRET", "TOP SECRET"]),
  password:  z.string().min(6, "Min 6 characters"),
});

// POST /api/team — invite new operator (admin only)
router.post("/", requireRole("admin", "senior_operator"), async (req: AuthRequest, res) => {
  const parsed = InviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    // Check email uniqueness
    const [existing] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, parsed.data.email)).limit(1);
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const allUsers = await db.select({ operatorId: users.operatorId }).from(users)
      .orderBy(users.createdAt);
    const lastId = allUsers.at(-1)?.operatorId ?? "OP-04000";
    const nextNum = parseInt(lastId.replace("OP-", ""), 10) + 1;
    const operatorId = `OP-${String(nextNum).padStart(5, "0")}`;

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const [created] = await db.insert(users).values({
      operatorId,
      name:         parsed.data.name,
      email:        parsed.data.email,
      passwordHash,
      role:         parsed.data.role,
      clearance:    parsed.data.clearance,
      status:       "offline",
    }).returning({
      id:         users.id,
      operatorId: users.operatorId,
      name:       users.name,
      email:      users.email,
      role:       users.role,
      clearance:  users.clearance,
      status:     users.status,
    });

    // Audit log
    await db.insert(auditLogs).values({
      userId:       req.user!.userId,
      operatorName: req.user!.name,
      action:       "INVITE_OPERATOR",
      resource:     "users",
      resourceId:   created.id,
      details:      { operatorId, name: parsed.data.name, role: parsed.data.role },
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("[team/invite]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/team/:id — update role/clearance (admin only)
router.patch("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const { role, clearance } = req.body as {
    role?: "admin" | "senior_operator" | "operator" | "analyst" | "viewer";
    clearance?: "UNCLASSIFIED" | "SECRET" | "TOP SECRET";
  };

  const allowed = {
    ...(role      && { role }),
    ...(clearance && { clearance }),
  };

  if (Object.keys(allowed).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  try {
    const [updated] = await db.update(users)
      .set(allowed)
      .where(eq(users.id, id))
      .returning({
        id: users.id, operatorId: users.operatorId, name: users.name,
        email: users.email, role: users.role, clearance: users.clearance,
        status: users.status, lastActive: users.lastActive, createdAt: users.createdAt,
      });

    if (!updated) { res.status(404).json({ error: "Operator not found" }); return; }

    await db.insert(auditLogs).values({
      userId: req.user!.userId, operatorName: req.user!.name,
      action: "PROFILE_UPDATE", resource: "users", resourceId: id,
      details: allowed,
    });

    res.json(updated);
  } catch (err) {
    console.error("[team/patch]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/team/:id — remove operator (admin only, cannot self-delete)
router.delete("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  const id = req.params.id as string;

  if (id === req.user!.userId) {
    res.status(400).json({ error: "Cannot remove yourself" });
    return;
  }

  try {
    const [removed] = await db.delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id, name: users.name });

    if (!removed) { res.status(404).json({ error: "Operator not found" }); return; }

    await db.insert(auditLogs).values({
      userId:       req.user!.userId,
      operatorName: req.user!.name,
      action:       "REMOVE_OPERATOR",
      resource:     "users",
      resourceId:   id,
      details:      { removedName: removed.name },
    });

    res.json({ message: "Operator removed" });
  } catch (err) {
    console.error("[team/remove]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
