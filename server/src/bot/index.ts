import { Telegraf } from "telegraf";
import { registerCommands } from "./commands.js";
import { setBot } from "./notifier.js";

let bot: Telegraf | null = null;

export function getBot(): Telegraf | null {
  return bot;
}

const BOT_COMMANDS = [
  { command: "status",    description: "📊 Статус системы — сенсоры, дроны, инциденты" },
  { command: "threats",   description: "🚁 Активные угрозы — список дронов" },
  { command: "incidents", description: "⚡ Открытые инциденты" },
  { command: "sensors",   description: "📡 Состояние сенсорной сети" },
  { command: "drone",     description: "🔍 Данные дрона — /drone DRN-001" },
  { command: "incident",  description: "📋 Данные инцидента — /incident INC-001" },
  { command: "ack",       description: "✅ Подтвердить алерт — /ack <id>" },
  { command: "auth",      description: "🔐 Получить код привязки аккаунта" },
  { command: "stop",      description: "🔕 Отписаться от уведомлений" },
  { command: "help",      description: "📖 Список всех команд" },
];

const BOT_DESCRIPTION =
  "🛡 Sky Guardian — система обнаружения и противодействия БПЛА\n\n" +
  "Этот бот подключён к оперативному центру и отправляет:\n" +
  "• 🚨 Критические тревоги о новых угрозах\n" +
  "• ⚡ Открытие и обновление инцидентов\n" +
  "• 📡 Изменения статуса сенсоров\n" +
  "• 💥 Подтверждения нейтрализации\n\n" +
  "Для начала работы — привяжите аккаунт оператора командой /auth";

const BOT_SHORT_DESCRIPTION =
  "Оперативные уведомления Sky Guardian DDS — угрозы, инциденты, сенсоры";

async function configureBotProfile(b: Telegraf) {
  try {
    // Set commands menu (shown in the "/" menu inside Telegram)
    await b.telegram.setMyCommands(BOT_COMMANDS);

    // Set full description (shown on the bot's profile page / "Start" screen)
    await (b.telegram as any).callApi("setMyDescription", {
      description: BOT_DESCRIPTION,
      language_code: "ru",
    });

    // Set short description (shown in search results)
    await (b.telegram as any).callApi("setMyShortDescription", {
      short_description: BOT_SHORT_DESCRIPTION,
      language_code: "ru",
    });

    console.log("   ✅ Bot profile configured (commands, description)");
  } catch (err: any) {
    console.warn("   ⚠ Bot profile setup partial:", err?.message);
  }
}

export function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("   ⚠ TELEGRAM_BOT_TOKEN not set — bot disabled");
    return;
  }

  bot = new Telegraf(token);
  setBot(bot);
  registerCommands(bot);

  // Configure profile before launching (fire-and-forget, non-blocking)
  configureBotProfile(bot).catch(() => {});

  console.log("   🤖 Telegram Bot starting (@SkyGuardianDDS_Bot)...");
  bot.launch().catch((err) => {
    console.error("   ❌ Telegram Bot failed to start:", err.message);
  });
  console.log("   🤖 Telegram Bot launched");

  process.once("SIGINT",  () => bot?.stop("SIGINT"));
  process.once("SIGTERM", () => bot?.stop("SIGTERM"));
}
