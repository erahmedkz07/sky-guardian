import type { Telegraf } from "telegraf";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { isNotNull } from "drizzle-orm";

export type NotifyLevel = "info" | "warning" | "critical";

export interface ThreatNotification {
  callsign: string;
  model:    string;
  threat:   string;
  lat:      number;
  lng:      number;
  confidence: number;
  sensorName?: string;
}

export interface IncidentNotification {
  code:   string;
  title:  string;
  threat: string;
  status: string;
}

export interface SensorNotification {
  id:     string;
  name:   string;
  status: string;
}

let _bot: Telegraf | null = null;

export function setBot(bot: Telegraf) {
  _bot = bot;
}

async function getSubscribers(): Promise<bigint[]> {
  if (!_bot) return [];
  try {
    const rows = await db
      .select({ chatId: users.telegramChatId })
      .from(users)
      .where(isNotNull(users.telegramChatId));
    return rows.map((r) => r.chatId!);
  } catch {
    return [];
  }
}

async function broadcast(text: string) {
  if (!_bot) return;
  const subs = await getSubscribers();
  for (const chatId of subs) {
    _bot.telegram.sendMessage(Number(chatId), text, { parse_mode: "HTML" }).catch(() => {});
  }
}

export const notifier = {
  async threat(n: ThreatNotification) {
    const emoji = n.threat === "critical" ? "🚨" : n.threat === "high" ? "🔴" : "🟡";
    const conf  = Math.round(n.confidence * 100);
    await broadcast(
      `${emoji} <b>ТРЕВОГА — ${n.threat.toUpperCase()}</b>\n` +
      `Дрон: <b>${n.model}</b> · ${n.callsign}\n` +
      `Координаты: ${n.lat.toFixed(4)}° N, ${n.lng.toFixed(4)}° E\n` +
      `Уверенность ИИ: <b>${conf}%</b>` +
      (n.sensorName ? `\nСенсор: ${n.sensorName}` : "")
    );
  },

  async incident(n: IncidentNotification) {
    const threatEmoji = n.threat === "critical" ? "🚨" : n.threat === "high" ? "⚡" : "⚠️";
    const STATUS_META: Record<string, { emoji: string; label: string }> = {
      open:           { emoji: threatEmoji, label: "Инцидент открыт" },
      investigating:  { emoji: "🔎", label: "Инцидент в расследовании" },
      resolved:       { emoji: "✅", label: "Инцидент закрыт (решён)" },
      dismissed:      { emoji: "🗑", label: "Инцидент отклонён" },
    };
    const meta = STATUS_META[n.status] ?? { emoji: "📋", label: "Статус инцидента изменён" };
    await broadcast(
      `${meta.emoji} <b>${meta.label}</b>\n` +
      `[${n.code}] ${n.title}\n` +
      `Угроза: <b>${n.threat.toUpperCase()}</b> · Статус: ${n.status}`
    );
  },

  async sensorDown(n: SensorNotification) {
    await broadcast(
      `⚠️ <b>Сенсор ${n.status === "offline" ? "ВЫКЛЮЧЕН" : "ДЕГРАДИРОВАН"}</b>\n` +
      `${n.name} (${n.id}) → <b>${n.status.toUpperCase()}</b>`
    );
  },

  async sensorRestored(n: SensorNotification) {
    await broadcast(
      `🟢 <b>Сенсор восстановлен</b>\n` +
      `${n.name} (${n.id}) → ONLINE`
    );
  },

  async playbookExecuted(name: string, threat: string) {
    await broadcast(
      `✅ <b>Сценарий выполнен</b>\n` +
      `${name} · угроза ${threat.toUpperCase()}`
    );
  },

  async droneStatusChange(callsign: string, oldStatus: string, newStatus: string) {
    const statusEmoji: Record<string, string> = {
      intercepted: "✈️", neutralized: "💥", lost: "❓", tracked: "🔍",
    };
    const e = statusEmoji[newStatus] ?? "📋";
    await broadcast(
      `${e} <b>Статус дрона изменён</b>\n` +
      `<b>${callsign}</b>: ${oldStatus.toUpperCase()} → <b>${newStatus.toUpperCase()}</b>\n` +
      `Угроза подавлена оператором.`
    );
  },

  async geoZoneBreach(zoneName: string, droneCallsign: string) {
    await broadcast(
      `🔴 <b>НАРУШЕНИЕ ПЕРИМЕТРА</b>\n` +
      `Геозона: <b>${zoneName}</b>\n` +
      `Нарушитель: ${droneCallsign}`
    );
  },
};
