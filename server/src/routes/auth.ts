import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { verifySync } from "otplib";
import { z } from "zod";
import { db } from "../db/client.js";
import { users, auditLogs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import type { Request } from "express";
import "dotenv/config";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

async function writeAudit(
  action: string,
  req: Request,
  opts: { userId?: string; operatorName?: string; details?: object } = {}
) {
  try {
    await db.insert(auditLogs).values({
      action,
      resource: "auth",
      ipAddress: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ?? req.socket.remoteAddress ?? null,
      userId:       opts.userId       ?? null,
      operatorName: opts.operatorName ?? null,
      details:      opts.details      ?? null,
    });
  } catch { /* non-critical */ }
}

const router = Router();

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user) {
      await writeAudit("LOGIN_FAILED", req, { details: { email, reason: "user_not_found" } });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // Account lockout check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainMs = user.lockedUntil.getTime() - Date.now();
      const remainMin = Math.ceil(remainMs / 60_000);
      await writeAudit("LOGIN_BLOCKED", req, { userId: user.id, operatorName: user.name, details: { reason: "account_locked", remainMin } });
      res.status(423).json({ error: `Account locked. Try again in ${remainMin} minute${remainMin !== 1 ? "s" : ""}.` });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const attempts = (user.loginAttempts ?? 0) + 1;
      const lockData: Record<string, unknown> = { loginAttempts: attempts };
      if (attempts >= MAX_ATTEMPTS) {
        lockData.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        lockData.loginAttempts = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.update(users).set(lockData as any).where(eq(users.id, user.id));
        await writeAudit("ACCOUNT_LOCKED", req, { userId: user.id, operatorName: user.name, details: { lockMinutes: LOCK_MINUTES } });
        res.status(423).json({ error: `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.` });
      } else {
        await db.update(users).set({ loginAttempts: attempts }).where(eq(users.id, user.id));
        await writeAudit("LOGIN_FAILED", req, { userId: user.id, operatorName: user.name, details: { attempt: attempts, maxAttempts: MAX_ATTEMPTS } });
        res.status(401).json({ error: `Invalid credentials. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} remaining.` });
      }
      return;
    }

    // Reset lockout on successful password match
    await db.update(users)
      .set({ loginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id));

    // If 2FA is enabled, return a short-lived pending token
    if (user.totpEnabled) {
      const pending = jwt.sign(
        { userId: user.id, type: "2fa_pending" },
        process.env.JWT_SECRET!,
        { expiresIn: "5m" },
      );
      res.json({ requiresTwoFactor: true, pendingToken: pending });
      return;
    }

    // Update status to online
    await db.update(users)
      .set({ status: "online", lastActive: new Date() })
      .where(eq(users.id, user.id));

    await writeAudit("LOGIN", req, { userId: user.id, operatorName: user.name });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET!,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: {
        id:         user.id,
        operatorId: user.operatorId,
        name:       user.name,
        email:      user.email,
        role:       user.role,
        clearance:  user.clearance,
        status:     "online",
        avatarUrl:  user.avatarUrl ?? null,
      },
    });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login/2fa
// Second factor step — validates TOTP code against the pending token
router.post("/login/2fa", async (req, res) => {
  const { pendingToken, code } = z.object({
    pendingToken: z.string(),
    code:         z.string().length(6),
  }).parse(req.body);

  let payload: { userId: string; type: string };
  try {
    payload = jwt.verify(pendingToken, process.env.JWT_SECRET!) as typeof payload;
  } catch {
    res.status(401).json({ error: "Expired or invalid pending token" });
    return;
  }
  if (payload.type !== "2fa_pending") {
    res.status(401).json({ error: "Invalid token type" });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!user || !user.totpEnabled || !user.totpSecret) {
    res.status(400).json({ error: "2FA not configured for this account" });
    return;
  }

  const checkResult = verifySync({ token: code, secret: user.totpSecret });
  const codeValid   = typeof checkResult === "object" ? checkResult.valid : !!checkResult;
  if (!codeValid) {
    res.status(401).json({ error: "Invalid authenticator code" });
    return;
  }

  await db.update(users)
    .set({ status: "online", lastActive: new Date() })
    .where(eq(users.id, user.id));

  await writeAudit("LOGIN_2FA", req, { userId: user.id, operatorName: user.name });

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET!,
    { expiresIn: "24h" },
  );

  res.json({
    token,
    user: {
      id:         user.id,
      operatorId: user.operatorId,
      name:       user.name,
      email:      user.email,
      role:       user.role,
      clearance:  user.clearance,
      status:     "online",
      avatarUrl:  user.avatarUrl ?? null,
    },
  });
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    res.json({
      id:         user.id,
      operatorId: user.operatorId,
      name:       user.name,
      email:      user.email,
      role:       user.role,
      clearance:  user.clearance,
      status:     user.status,
      avatarUrl:  user.avatarUrl ?? null,
    });
  } catch (err) {
    console.error("[auth/me]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/logout
router.post("/logout", requireAuth, async (req: AuthRequest, res) => {
  try {
    await db.update(users)
      .set({ status: "offline", lastActive: new Date() })
      .where(eq(users.id, req.user!.userId));
    await writeAudit("LOGOUT", req, { userId: req.user!.userId, operatorName: req.user!.name });
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("[auth/logout]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(6, "Min 6 characters"),
});

// PATCH /api/auth/me/password
router.patch("/me/password", requireAuth, async (req: AuthRequest, res) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await db.update(users)
      .set({ passwordHash: newHash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await writeAudit("PASSWORD_CHANGED", req, { userId: user.id, operatorName: user.name });
    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("[auth/me/password]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
