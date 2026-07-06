import type { Telegraf } from "telegraf";
import { db } from "../db/client.js";
import {
  users, sensors, drones, incidents, alertEvents, telegramAuthCodes,
} from "../db/schema.js";
import { eq, desc, and, isNull, gt } from "drizzle-orm";
import crypto from "crypto";

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty", hour12: false });
}

const threatEmoji: Record<string, string> = {
  critical: "🚨", high: "🔴", medium: "🟡", low: "🟢",
};

export function registerCommands(bot: Telegraf) {
  // ─── /start ────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    const firstName = ctx.from?.first_name ?? "Оператор";
    const existing = await db.select().from(users).where(eq(users.telegramChatId, BigInt(chatId)));

    if (existing.length > 0) {
      const u = existing[0];
      const roleLabel: Record<string, string> = {
        admin: "Администратор", senior_operator: "Ст. Оператор",
        operator: "Оператор", analyst: "Аналитик", viewer: "Наблюдатель",
      };
      await ctx.reply(
        `🛡 <b>Sky Guardian DDS</b>\n` +
        `<i>Drone Defense System — Оперативный центр</i>\n\n` +
        `С возвращением, <b>${u.name}</b>\n` +
        `<code>${u.operatorId}</code> · ${roleLabel[u.role] ?? u.role}\n\n` +
        `Система активна. Используй /status для текущего состояния\n` +
        `или /help для полного списка команд.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await ctx.reply(
      `🛡 <b>Sky Guardian DDS</b>\n` +
      `<i>Drone Defense System — Оперативный центр</i>\n\n` +
      `Привет, ${firstName}. Этот бот — оперативный канал уведомлений Sky Guardian.\n\n` +
      `Чтобы получать тревоги и работать с командами, привяжи свой аккаунт оператора:\n\n` +
      `<b>① Привязка аккаунта:</b>\n` +
      `   1. Нажми /auth — получишь 6-значный код\n` +
      `   2. Открой <b>Sky Guardian</b> в браузере\n` +
      `   3. Перейди в <b>Профиль → Telegram</b>\n` +
      `   4. Введи код → готово\n\n` +
      `⏱ Код действует <b>10 минут</b>.\n\n` +
      `После привязки ты будешь получать:\n` +
      `🚨 Критические угрозы · ⚡ Инциденты · 📡 Статус сенсоров`,
      { parse_mode: "HTML" }
    );
  });

  // ─── /auth ─────────────────────────────────────────────────
  bot.command("auth", async (ctx) => {
    const chatId = ctx.chat.id;

    const existing = await db.select().from(users).where(eq(users.telegramChatId, BigInt(chatId)));
    if (existing.length > 0) {
      const u = existing[0];
      await ctx.reply(
        `✅ <b>Аккаунт уже привязан</b>\n\n` +
        `Оператор: <b>${u.name}</b> [<code>${u.operatorId}</code>]\n\n` +
        `Используй /status для проверки состояния системы.\n` +
        `Чтобы отвязать аккаунт — напиши /stop.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Remove old codes for this chat
    await db.delete(telegramAuthCodes).where(eq(telegramAuthCodes.chatId, BigInt(chatId)));

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(telegramAuthCodes).values({ code, chatId: BigInt(chatId), expiresAt });

    await ctx.reply(
      `🔐 <b>Код привязки аккаунта</b>\n\n` +
      `Твой одноразовый код:\n\n` +
      `<code>${code}</code>\n\n` +
      `<b>Шаги:</b>\n` +
      `1. Открой Sky Guardian в браузере\n` +
      `2. Профиль → раздел Telegram\n` +
      `3. Введи код выше\n\n` +
      `⏱ Код действителен <b>10 минут</b>\n` +
      `🔒 Одноразовый — после ввода аннулируется`,
      { parse_mode: "HTML" }
    );
  });

  // ─── /status ───────────────────────────────────────────────
  bot.command("status", async (ctx) => {
    if (!await requireAuth(ctx)) return;
    try {
      const [sensorRows, droneRows, incidentRows, alertRows] = await Promise.all([
        db.select().from(sensors),
        db.select().from(drones),
        db.select().from(incidents),
        db.select().from(alertEvents).where(eq(alertEvents.acknowledged, false)),
      ]);

      const online   = sensorRows.filter((s) => s.status === "online").length;
      const degraded = sensorRows.filter((s) => s.status === "degraded").length;
      const offline  = sensorRows.filter((s) => s.status === "offline").length;
      const critical = droneRows.filter((d) => d.threat === "critical").length;
      const high     = droneRows.filter((d) => d.threat === "high").length;
      const openInc  = incidentRows.filter((i) => i.status === "open" || i.status === "investigating").length;

      await ctx.reply(
        `🛡 <b>Статус системы</b>\n` +
        `${new Date().toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" })}\n\n` +
        `📡 <b>Сенсоры</b>\n` +
        `  🟢 Онлайн: ${online}  ⚠️ Деградирован: ${degraded}  🔴 Offline: ${offline}\n\n` +
        `🚁 <b>Дроны</b>\n` +
        `  Всего: ${droneRows.length}  🚨 Критических: ${critical}  🔴 Высоких: ${high}\n\n` +
        `⚡ <b>Инциденты</b>: ${openInc} открытых\n` +
        `🔔 <b>Алерты</b>: ${alertRows.length} непрочитанных`,
        { parse_mode: "HTML" }
      );
    } catch {
      await ctx.reply("❌ Ошибка получения данных.");
    }
  });

  // ─── /threats ──────────────────────────────────────────────
  bot.command("threats", async (ctx) => {
    if (!await requireAuth(ctx)) return;
    try {
      const rows = await db
        .select()
        .from(drones)
        .orderBy(desc(drones.detectedAt))
        .limit(10);

      if (rows.length === 0) {
        await ctx.reply("✅ Активных угроз не обнаружено.");
        return;
      }

      const lines = rows.map((d) => {
        const e = threatEmoji[d.threat] ?? "❓";
        const conf = Math.round(d.confidence * 100);
        return `${e} <b>${d.callsign}</b> · ${d.model}\n   ${d.lat.toFixed(4)}°N ${d.lng.toFixed(4)}°E · ${conf}% · ${d.status}`;
      });

      await ctx.reply(
        `🚁 <b>Активные угрозы</b> (${rows.length})\n\n` + lines.join("\n\n"),
        { parse_mode: "HTML" }
      );
    } catch {
      await ctx.reply("❌ Ошибка получения данных.");
    }
  });

  // ─── /incidents ────────────────────────────────────────────
  bot.command("incidents", async (ctx) => {
    if (!await requireAuth(ctx)) return;
    try {
      const rows = await db
        .select()
        .from(incidents)
        .orderBy(desc(incidents.createdAt))
        .limit(8);

      const open = rows.filter((i) => i.status === "open" || i.status === "investigating");

      if (open.length === 0) {
        await ctx.reply("✅ Открытых инцидентов нет.");
        return;
      }

      const lines = open.map((i) => {
        const e = threatEmoji[i.threat] ?? "❓";
        return `${e} [<code>${i.code}</code>] <b>${i.title}</b>\n   Статус: ${i.status} · ${formatDate(i.createdAt)}`;
      });

      await ctx.reply(
        `⚡ <b>Открытые инциденты</b> (${open.length})\n\n` + lines.join("\n\n"),
        { parse_mode: "HTML" }
      );
    } catch {
      await ctx.reply("❌ Ошибка получения данных.");
    }
  });

  // ─── /sensors ──────────────────────────────────────────────
  bot.command("sensors", async (ctx) => {
    if (!await requireAuth(ctx)) return;
    try {
      const rows = await db.select().from(sensors).orderBy(sensors.status);

      const statusEmoji: Record<string, string> = {
        online: "🟢", degraded: "⚠️", offline: "🔴", maintenance: "🔧",
      };

      const lines = rows.map((s) => {
        const e = statusEmoji[s.status] ?? "❓";
        return `${e} <b>${s.name}</b> [${s.id}]\n   ${s.type} · Сигнал: ${s.signal}% · Здоровье: ${s.health}%`;
      });

      await ctx.reply(
        `📡 <b>Сенсорная сеть</b> (${rows.length})\n\n` + lines.join("\n\n"),
        { parse_mode: "HTML" }
      );
    } catch {
      await ctx.reply("❌ Ошибка получения данных.");
    }
  });

  // ─── /drone <id> ───────────────────────────────────────────
  bot.command("drone", async (ctx) => {
    if (!await requireAuth(ctx)) return;
    const parts = ctx.message.text.split(" ");
    const id = parts[1];
    if (!id) {
      await ctx.reply("Использование: /drone <id_дрона>\nПример: /drone DRN-001");
      return;
    }
    try {
      const [d] = await db.select().from(drones).where(eq(drones.id, id)).limit(1);
      if (!d) {
        await ctx.reply(`❌ Дрон <code>${id}</code> не найден.`, { parse_mode: "HTML" });
        return;
      }
      const e = threatEmoji[d.threat] ?? "❓";
      const conf = Math.round(d.confidence * 100);
      await ctx.reply(
        `🚁 <b>Дрон ${d.callsign}</b>\n\n` +
        `${e} Угроза: <b>${d.threat.toUpperCase()}</b>\n` +
        `📋 Статус: <b>${d.status}</b>\n` +
        `🛸 Модель: ${d.model}\n` +
        `📍 Координаты: ${d.lat.toFixed(4)}°N, ${d.lng.toFixed(4)}°E\n` +
        `📏 Высота: ${d.altitudeM} м\n` +
        `💨 Скорость: ${Math.round(d.speedKmh)} км/ч\n` +
        `🧭 Курс: ${Math.round(d.headingDeg)}°\n` +
        `🎯 Уверенность: ${conf}%\n` +
        `🕐 Обнаружен: ${formatDate(d.detectedAt)}`,
        { parse_mode: "HTML" }
      );
    } catch {
      await ctx.reply("❌ Ошибка получения данных.");
    }
  });

  // ─── /incident <code> ──────────────────────────────────────
  bot.command("incident", async (ctx) => {
    if (!await requireAuth(ctx)) return;
    const parts = ctx.message.text.split(" ");
    const code = parts[1];
    if (!code) {
      await ctx.reply("Использование: /incident <код>\nПример: /incident INC-001");
      return;
    }
    try {
      const [inc] = await db.select().from(incidents).where(eq(incidents.code, code.toUpperCase())).limit(1);
      if (!inc) {
        await ctx.reply(`❌ Инцидент <code>${code}</code> не найден.`, { parse_mode: "HTML" });
        return;
      }
      const e = threatEmoji[inc.threat] ?? "❓";
      const statusLabel: Record<string, string> = {
        open: "⚡ Открыт", investigating: "🔍 Расследуется", resolved: "✅ Решён", dismissed: "🚫 Отклонён",
      };
      await ctx.reply(
        `⚡ <b>Инцидент [${inc.code}]</b>\n\n` +
        `📋 <b>${inc.title}</b>\n\n` +
        `${e} Угроза: <b>${inc.threat.toUpperCase()}</b>\n` +
        `📊 Статус: ${statusLabel[inc.status] ?? inc.status}\n` +
        (inc.assignee ? `👤 Назначен: ${inc.assignee}\n` : "") +
        (inc.description ? `\n📝 ${inc.description}\n` : "") +
        `\n🕐 Создан: ${formatDate(inc.createdAt)}\n` +
        `🔄 Обновлён: ${formatDate(inc.updatedAt)}`,
        { parse_mode: "HTML" }
      );
    } catch {
      await ctx.reply("❌ Ошибка получения данных.");
    }
  });

  // ─── /ack <id> ─────────────────────────────────────────────
  bot.command("ack", async (ctx) => {
    if (!await requireAuth(ctx)) return;
    const parts = ctx.message.text.split(" ");
    const id = parts[1];
    if (!id) {
      await ctx.reply("Использование: /ack <id_оповещения>");
      return;
    }
    try {
      const [updated] = await db
        .update(alertEvents)
        .set({ acknowledged: true })
        .where(eq(alertEvents.id, id))
        .returning();
      if (!updated) {
        await ctx.reply(`❌ Оповещение <code>${id}</code> не найдено.`, { parse_mode: "HTML" });
        return;
      }
      await ctx.reply(`✅ Оповещение <code>${id}</code> подтверждено.`, { parse_mode: "HTML" });
    } catch {
      await ctx.reply("❌ Ошибка.");
    }
  });

  // ─── /help ─────────────────────────────────────────────────
  bot.command("help", async (ctx) => {
    const isLinked = await requireAuth(ctx, /* silent */ true);
    await ctx.reply(
      `🛡 <b>Sky Guardian DDS — Справка</b>\n` +
      `<i>Drone Defense System · Оперативный центр</i>\n\n` +
      (isLinked ? `🟢 Аккаунт привязан\n\n` : `🔴 Аккаунт не привязан — /auth\n\n`) +
      `<b>📊 Мониторинг</b>\n` +
      `/status — общий статус системы\n` +
      `/threats — активные угрозы (топ-10)\n` +
      `/incidents — открытые инциденты\n` +
      `/sensors — состояние сенсорной сети\n\n` +
      `<b>🔍 Детальные запросы</b>\n` +
      `/drone <code>DRN-001</code> — данные дрона по ID\n` +
      `/incident <code>INC-001</code> — данные инцидента по коду\n\n` +
      `<b>⚙️ Управление</b>\n` +
      `/ack <code>&lt;id&gt;</code> — подтвердить алерт\n\n` +
      `<b>🔐 Аккаунт</b>\n` +
      `/auth — получить код привязки (10 мин)\n` +
      `/stop — отвязать аккаунт и отписаться\n\n` +
      `<i>Уведомления приходят автоматически при критических событиях.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ─── /stop ─────────────────────────────────────────────────
  bot.command("stop", async (ctx) => {
    const chatId = ctx.chat.id;
    const rows = await db.select().from(users).where(eq(users.telegramChatId, BigInt(chatId)));
    if (rows.length === 0) {
      await ctx.reply(
        `ℹ️ Твой аккаунт не привязан.\n\nЧтобы привязаться — напиши /auth.`
      );
      return;
    }
    const u = rows[0];
    await db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, BigInt(chatId)));
    await ctx.reply(
      `🔕 <b>Отписка выполнена</b>\n\n` +
      `Оператор <b>${u.name}</b> [${u.operatorId}] отключён от уведомлений.\n\n` +
      `Ты больше не будешь получать тревоги и оповещения.\n` +
      `Чтобы снова подключиться — напиши /auth.`,
      { parse_mode: "HTML" }
    );
  });
}

async function requireAuth(ctx: any, silent = false): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;
  const rows = await db.select().from(users).where(eq(users.telegramChatId, BigInt(chatId)));
  if (rows.length === 0) {
    if (!silent) {
      await ctx.reply(
        `🔒 <b>Доступ запрещён</b>\n\n` +
        `Эта команда доступна только привязанным операторам.\n\n` +
        `Напиши /auth — получишь код для привязки аккаунта.`,
        { parse_mode: "HTML" }
      );
    }
    return false;
  }
  return true;
}
