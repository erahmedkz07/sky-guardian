<div align="center">

# Sky Guardian

**Тактическая система противодействия БПЛА (Counter-UAS)**

Дипломный проект · Мониторинг воздушного пространства · Детекция дронов · AI-управление

<br />

[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-Real--time-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Leaflet](https://img.shields.io/badge/Leaflet-Maps-199900?style=for-the-badge&logo=leaflet&logoColor=white)](https://leafletjs.com/)

<br />

[О проекте](#-о-проекте) ·
[Возможности](#-возможности) ·
[Стек](#-технологический-стек) ·
[Запуск](#-быстрый-старт) ·
[Архитектура](#-архитектура)

</div>

---

## О проекте

**Sky Guardian** — full-stack платформа тактического противодействия беспилотным летательным аппаратам (БПЛА). Разработана как **дипломный проект** для мониторинга воздушного пространства, обнаружения дронов, оценки угроз и оперативного реагирования в реальном времени.

Система объединяет тактическую карту, сеть сенсоров (RF / RADAR / OPTIC / ACOUSTIC), управление инцидентами, AI-советник на базе Claude API и аппаратный контур на ESP32.

<p align="center">
  <img src="command-center.png" alt="Sky Guardian — Command Center" width="100%" />
  <br />
  <em>Command Center — тактическая карта с отслеживанием дронов в реальном времени</em>
</p>

| | |
|---|---|
| <img src="sg-home.jpeg" alt="Главная" width="100%" /> | <img src="sg-sensors.jpeg" alt="Сенсоры" width="100%" /> |
| <em>Дашборд системы</em> | <em>Сеть сенсоров</em> |

---

## Возможности

### Операторский центр
| Модуль | Описание |
|--------|----------|
| **Command Center** | Тактическая карта Leaflet, live-треки дронов, геозоны |
| **Live Feed** | Поток данных с сенсоров, частота, дистанция, скорость |
| **Historical Playback** | Запись сессий, scrubber, скорость 0.5×–5× |
| **Alert System** | Звуковые сигналы по уровню угрозы + push-уведомления |
| **Incidents** | Жизненный цикл: создание → расследование → закрытие |

### AI и автоматизация
| Модуль | Описание |
|--------|----------|
| **AI Engine** | 3 режима: Passive → Advisory → Autonomous |
| **Playbooks** | Сценарии автоматического реагирования |
| **Threat Intel** | IOC-фид с оценкой рисков |
| **Simulation** | Тренировочные сценарии без реального оборудования |

### Аналитика и инфраструктура
| Модуль | Описание |
|--------|----------|
| **Analytics** | Тренды детекций, распределение угроз, KPI сенсоров |
| **RF Spectrum** | Анализ частот, обнаружение глушения |
| **Reports** | Экспорт CSV (сервер) и PDF (клиент) |
| **Cameras** | RTSP / MJPEG видеопотоки |
| **Telegram Bot** | Оповещения операторов |
| **Hardware** | ESP32-CAM, RF-ноды (папка `hardware/`) |

### Безопасность
JWT · bcrypt · **TOTP 2FA** (RFC 6238) · RBAC (5 ролей) · Audit Log · Rate Limiting

---

## Технологический стек

```
┌──────────────────────────────────────────────────────────────┐
│                   Frontend (TanStack Start)                  │
│     React 19 · TypeScript · TanStack Router · Tailwind v4    │
│        Leaflet · Recharts · Socket.io-client · shadcn/ui     │
└────────────────────────────┬─────────────────────────────────┘
                             │ REST + WebSocket
┌────────────────────────────▼─────────────────────────────────┐
│                    Backend (Express 4)                       │
│   Node.js 22 · Drizzle ORM · JWT · TOTP · Claude AI API      │
│              Socket.io · Telegraf · Rate Limiting            │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│              PostgreSQL 16 · 17+ таблиц                      │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│         Hardware: ESP32-CAM · RF Nodes (Arduino/C++)         │
└──────────────────────────────────────────────────────────────┘
```

| Слой | Технологии |
|------|------------|
| **UI** | React 19, TanStack Start, Tailwind CSS v4, shadcn/ui |
| **Карты** | Leaflet, react-leaflet |
| **API** | Express, Drizzle ORM, Zod, 20+ REST endpoints |
| **Real-time** | Socket.io (`drone:update`, `alert:new`, `incident:update`) |
| **AI** | Anthropic Claude API — оценка угроз и рекомендации |
| **БД** | PostgreSQL 16, Drizzle migrations |
| **Железо** | ESP32-CAM, RF-датчики (`hardware/`) |

---

## Быстрый старт

### Требования

- **Node.js** 22+
- **PostgreSQL** 16+
- **npm** или **bun**

### 1. Клонирование

```bash
git clone https://github.com/erahmedkz07/sky-guardian.git
cd sky-guardian
```

### 2. Установка

```bash
# Frontend
npm install

# Backend
cd server && npm install && cd ..
```

### 3. Переменные окружения

```bash
cp .env.example .env
# server/.env — создайте вручную по образцу:
#   DATABASE_URL=postgresql://user:password@localhost:5432/sky_guardian
#   JWT_SECRET=your-super-secret-key-min-32-chars
#   ANTHROPIC_API_KEY=sk-ant-...  (для AI Engine)
```

| Переменная | Где | Описание |
|------------|-----|----------|
| `VITE_API_URL` | `.env` | URL backend API |
| `VITE_WS_URL` | `.env` | URL WebSocket |
| `DATABASE_URL` | `server/.env` | PostgreSQL connection string |
| `JWT_SECRET` | `server/.env` | Секрет JWT (мин. 32 символа) |

### 4. База данных

```bash
cd server
npm run db:push
npm run seed
```

### 5. Запуск

```bash
# Оба сервера (из корня)
bash start-dev.sh

# Или отдельно:
cd server && npm run dev   # API :3001
npm run dev                # Frontend :5173
```

Откройте **http://localhost:5173**

**Демо-доступ:** `cnb@dds.kz` / `password123`

---

## Архитектура

```
sky-guardian/
├── src/
│   ├── components/     # AppShell, TacticalMap, RadarScope, PlaybackBar…
│   ├── lib/            # store, api, sounds, reportPdf, recorder…
│   ├── routes/         # TanStack Router (file-based)
│   └── styles.css      # Tactical HUD design system
├── server/
│   ├── src/
│   │   ├── db/         # Drizzle schema + migrations
│   │   ├── routes/     # 20+ REST API handlers
│   │   ├── services/   # AI engine, WebSocket broadcaster
│   │   ├── ws/         # Socket.io drone stream
│   │   └── bot/        # Telegram-бот
│   └── uploads/        # Аватары операторов
├── hardware/
│   ├── esp32cam/       # Прошивка ESP32-CAM
│   ├── node1/          # RF-сенсор нода 1
│   └── node2/          # RF-сенсор нода 2
├── ЗАЩИТА_СКРИПТ_KZ.md # Скрипт защиты диплома (KZ)
└── start-dev.sh
```

### WebSocket-события

`drone:update` · `drone:new` · `drone:remove` · `alert:new` · `incident:update`

---

## Научная новизна

Трёхуровневая модель AI-автономии позволяет оператору постепенно наращивать доверие к системе:

1. **Passive** — AI только наблюдает и анализирует
2. **Advisory** — AI рекомендует действия, решение за человеком
3. **Autonomous** — выполнение playbooks по заданным сценариям

---

## Дорожная карта

- [ ] Интеграция с реальными RF/radar сенсорами в полевых условиях
- [ ] Kubernetes-деплой для масштабирования
- [ ] Мобильное приложение оператора
- [ ] Расширение hardware-контура (дополнительные ноды)

---

<div align="center">

**Sky Guardian** — тактическая система противодействия БПЛА.

Дипломный проект · © 2025–2026 [erahmedkz07](https://github.com/erahmedkz07)

</div>
