import { Router } from "express";
import { db } from "../db/client.js";
import { users, telegramAuthCodes } from "../db/schema.js";
import { eq, and, gt } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { getBot } from "../bot/index.js";

const router = Router();

router.post("/link", requireAuth, async (req: AuthRequest, res) => {
  const { code } = req.body as { code?: string };
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Invalid code format" });
  }

  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const [row] = await db
    .select()
    .from(telegramAuthCodes)
    .where(and(eq(telegramAuthCodes.code, code), gt(telegramAuthCodes.expiresAt, new Date())));

  if (!row) return res.status(400).json({ error: "Code not found or expired" });

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramChatId, row.chatId));

  if (existing.length > 0 && existing[0].id !== userId) {
    return res.status(409).json({ error: "This Telegram account is already linked to another user" });
  }

  const [user] = await db
    .select({ name: users.name, operatorId: users.operatorId })
    .from(users)
    .where(eq(users.id, userId));

  await db.update(users).set({ telegramChatId: row.chatId }).where(eq(users.id, userId));
  await db.delete(telegramAuthCodes).where(eq(telegramAuthCodes.code, code));

  // Notify user in Telegram
  const bot = getBot();
  if (bot) {
    bot.telegram.sendMessage(
      Number(row.chatId),
      `✅ <b>Аккаунт привязан!</b>\n\n` +
      `Оператор: <b>${user?.name ?? "—"}</b> [${user?.operatorId ?? "—"}]\n\n` +
      `Теперь ты будешь получать уведомления о:\n` +
      `🚨 Критических угрозах\n` +
      `⚡ Новых инцидентах\n` +
      `📡 Изменениях статуса сенсоров\n\n` +
      `Напиши /help для списка команд.`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  }

  return res.json({ ok: true });
});

router.delete("/unlink", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const [user] = await db
    .select({ telegramChatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId));

  await db.update(users).set({ telegramChatId: null }).where(eq(users.id, userId));

  // Notify user in Telegram about unlink
  const bot = getBot();
  if (bot && user?.telegramChatId) {
    bot.telegram.sendMessage(
      Number(user.telegramChatId),
      `🔕 <b>Аккаунт отвязан</b>\n\nТы отписан от уведомлений Sky Guardian.\nНапиши /auth чтобы привязаться снова.`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  }

  return res.json({ ok: true });
});

router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const [user] = await db
    .select({ telegramChatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId));

  return res.json({ linked: !!user?.telegramChatId });
});

// GET /api/telegram/bot-info — public bot presence info (no token exposed)
router.get("/bot-info", requireAuth, async (_req, res) => {
  const bot = getBot();
  if (!bot) {
    return res.json({ configured: false, username: null });
  }
  try {
    const me = await bot.telegram.getMe();
    return res.json({ configured: true, username: me.username ?? null });
  } catch {
    return res.json({ configured: !!process.env.TELEGRAM_BOT_TOKEN, username: null });
  }
});

export default router;
