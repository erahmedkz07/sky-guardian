import { createFileRoute } from "@tanstack/react-router";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import { useT } from "@/lib/i18n";
import {
  Webhook,
  Cpu,
  Cloud,
  MessageSquare,
  CheckCircle,
  XCircle,
  Loader2,
  Link2,
  Link2Off,
  Info,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { telegramApi } from "@/lib/api";

export const Route = createFileRoute("/integrations")({
  component: Integrations,
  head: () => ({ meta: [{ title: "Integrations // DDS" }] }),
});

// ─── Types ────────────────────────────────────────────────────
type ConnState = "connected" | "disconnected" | "connecting" | "disconnecting" | "error";

interface IntegDef {
  id: string;
  icon: typeof Cpu;
  name: string;
  desc: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHint?: string;
  keyType?: "text" | "password" | "url" | "telegram-code";
  validate: (v: string) => string | null;
  alwaysActive?: boolean;    // REST API — built-in, no config needed
  realApi?: boolean;         // uses real backend API (Telegram)
  instructions?: string[];   // extra help lines shown in disconnected state
}

const INTEGRATIONS: IntegDef[] = [
  {
    id: "telegram",
    icon: MessageSquare,
    name: "Telegram Bot",
    desc: "Critical alerts to ops channel",
    keyLabel: "Confirmation code",
    keyPlaceholder: "123456",
    keyType: "telegram-code",
    keyHint: "6-digit code from bot",
    validate: (v) => /^\d{6}$/.test(v.trim()) ? null : "Code must be 6 digits",
    realApi: true,
    instructions: [
      "Find the bot in Telegram",
      "Send /start to get code",
      "Enter the code below",
    ],
  },
  {
    id: "arduino",
    icon: Cpu,
    name: "Arduino / ESP32",
    desc: "Hardware sensor gateway · API key",
    keyLabel: "Hardware API key",
    keyPlaceholder: "sg-hw-xxxxxxxxxxxxxxxx",
    keyType: "password",
    validate: (v) => v.trim().length >= 8 ? null : "Key must be at least 8 characters",
  },
  {
    id: "webhooks",
    icon: Webhook,
    name: "Webhooks",
    desc: "Outbound webhooks on incident.created",
    keyLabel: "Recipient URL",
    keyPlaceholder: "https://hooks.example.com/endpoint",
    keyType: "url",
    validate: (v) => {
      try { new URL(v.trim()); return null; }
      catch { return "Enter a valid URL (https://...)"; }
    },
  },
  {
    id: "norad",
    icon: Cloud,
    name: "NORAD CUAS Feed",
    desc: "Inbound IOC data replication",
    keyLabel: "Auth token",
    keyPlaceholder: "Bearer norad-tk-xxxxxxxx",
    keyType: "password",
    validate: (v) => v.trim().length >= 10 ? null : "Token too short",
  },
  {
    id: "s3",
    icon: Cloud,
    name: "S3 Archive",
    desc: "Detection log cold storage (S3)",
    keyLabel: "Access Key ID",
    keyPlaceholder: "AKIAIOSFODNN7EXAMPLE",
    keyType: "password",
    validate: (v) => v.trim().length >= 16 ? null : "Enter AWS Access Key ID",
  },
  {
    id: "rest",
    icon: Webhook,
    name: "REST API",
    desc: "Public API · rate limited",
    keyLabel: "",
    keyPlaceholder: "",
    validate: () => null,
    alwaysActive: true,
  },
];

const STORE_KEY = "dds_integrations_v2";

function loadStored(): Record<string, { key: string; connectedAt: string }> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"); }
  catch { return {}; }
}

function saveStored(data: Record<string, { key: string; connectedAt: string }>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch { /* ignore */ }
}

function maskKey(key: string): string {
  if (!key) return "—";
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 4) + "•".repeat(Math.min(key.length - 6, 12)) + key.slice(-3);
}

// ─── Main page ────────────────────────────────────────────────
function Integrations() {
  const { t } = useT();
  const [stored, setStored] = useState<Record<string, { key: string; connectedAt: string }>>(() => loadStored());
  // Per-integration UI state
  const [states, setStates]   = useState<Record<string, ConnState>>({});
  const [inputs, setInputs]   = useState<Record<string, string>>({});
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [botInfo, setBotInfo] = useState<{ configured: boolean; username: string | null } | null>(null);

  // Load real Telegram status on mount
  useEffect(() => {
    telegramApi.status()
      .then(({ linked }) => {
        if (linked) {
          setStates((p) => ({ ...p, telegram: "connected" }));
        }
      })
      .catch(() => {});

    telegramApi.botInfo()
      .then(setBotInfo)
      .catch(() => {});
  }, []);

  function getState(id: string, def: IntegDef): ConnState {
    if (def.alwaysActive) return "connected";
    if (states[id]) return states[id];
    if (stored[id]) return "connected";
    return "disconnected";
  }

  const handleConnect = useCallback(async (def: IntegDef) => {
    const key = (inputs[def.id] ?? "").trim();
    const err = def.validate(key);
    if (err) { setErrors((p) => ({ ...p, [def.id]: err })); return; }

    setErrors((p) => ({ ...p, [def.id]: "" }));
    setStates((p) => ({ ...p, [def.id]: "connecting" }));

    try {
      if (def.realApi && def.id === "telegram") {
        await telegramApi.link(key);
      } else {
        // Simulate a brief verification delay for non-real integrations
        await new Promise((r) => setTimeout(r, 900));
      }

      const next = { ...stored, [def.id]: { key, connectedAt: new Date().toISOString() } };
      setStored(next);
      saveStored(next);
      setStates((p) => ({ ...p, [def.id]: "connected" }));
      setInputs((p) => ({ ...p, [def.id]: "" }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Connection error";
      setErrors((p) => ({ ...p, [def.id]: msg }));
      setStates((p) => ({ ...p, [def.id]: "error" }));
      setTimeout(() => setStates((p) => ({ ...p, [def.id]: "disconnected" })), 3000);
    }
  }, [inputs, stored]);

  const handleDisconnect = useCallback(async (def: IntegDef) => {
    setStates((p) => ({ ...p, [def.id]: "disconnecting" }));
    try {
      if (def.realApi && def.id === "telegram") {
        await telegramApi.unlink();
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
      const next = { ...stored };
      delete next[def.id];
      setStored(next);
      saveStored(next);
      setStates((p) => ({ ...p, [def.id]: "disconnected" }));
    } catch {
      setStates((p) => ({ ...p, [def.id]: "connected" }));
    }
  }, [stored]);

  // Stats
  const connectedCount = INTEGRATIONS.filter((d) => {
    const s = getState(d.id, d);
    return s === "connected";
  }).length;

  return (
    <div>
      <PageHeader
        title={t("Integrations")}
        subtitle={t("External systems · IoT · webhooks · APIs")}
        actions={
          <span className="border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {connectedCount} / {INTEGRATIONS.length} {t("connected")}
          </span>
        }
      />

      <div className="grid gap-3 px-4 py-4 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((def) => {
          const state = getState(def.id, def);
          return (
            <IntegCard
              key={def.id}
              def={def}
              state={state}
              input={inputs[def.id] ?? ""}
              error={errors[def.id] ?? ""}
              storedKey={stored[def.id]?.key ?? ""}
              connectedAt={stored[def.id]?.connectedAt}
              botInfo={def.id === "telegram" ? botInfo : null}
              onInputChange={(v) => {
                setInputs((p) => ({ ...p, [def.id]: v }));
                if (errors[def.id]) setErrors((p) => ({ ...p, [def.id]: "" }));
              }}
              onConnect={() => handleConnect(def)}
              onDisconnect={() => handleDisconnect(def)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Integration Card ─────────────────────────────────────────
function IntegCard({
  def, state, input, error, storedKey, connectedAt, botInfo,
  onInputChange, onConnect, onDisconnect,
}: {
  def: IntegDef;
  state: ConnState;
  input: string;
  error: string;
  storedKey: string;
  connectedAt?: string;
  botInfo?: { configured: boolean; username: string | null } | null;
  onInputChange: (v: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useT();
  const Icon = def.icon;
  const isConnected    = state === "connected";
  const isConnecting   = state === "connecting";
  const isDisconnecting = state === "disconnecting";
  const isError        = state === "error";
  const isBusy         = isConnecting || isDisconnecting;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isBusy) onConnect();
  };

  return (
    <HudPanel bodyClassName="p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center border transition-colors ${
            isConnected ? "border-hud/40 bg-hud/10" : "border-border/50 bg-panel/40"
          }`}>
            <Icon className={`h-5 w-5 ${isConnected ? "text-hud" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-widest">{def.name}</div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{t(def.desc)}</div>
          </div>
        </div>
        <StatusBadge state={state} />
      </div>

      {/* Always-active: built-in info */}
      {def.alwaysActive && (
        <div className="border border-hud/20 bg-hud/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.15em] text-hud">{t("/api/v1/* · Active")}</div>
          <div className="mt-0.5 text-[9px] text-muted-foreground">{t("Built-in API · no token required")}</div>
        </div>
      )}

      {/* Telegram bot status line */}
      {def.id === "telegram" && botInfo && (
        <div className={`flex items-center gap-2 border px-3 py-2 text-[10px] ${
          botInfo.configured
            ? "border-hud/20 bg-hud/5 text-hud"
            : "border-border/40 text-muted-foreground"
        }`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${botInfo.configured ? "bg-hud animate-pulse" : "bg-muted-foreground"}`} />
          {botInfo.configured
            ? `Bot @${botInfo.username ?? "sky_guardian_bot"} · active`
            : "Bot not configured · check TELEGRAM_BOT_TOKEN"}
        </div>
      )}

      {/* Connected state */}
      {isConnected && !def.alwaysActive && (
        <div className="space-y-2">
          {storedKey && (
            <div className="border border-border/40 bg-background/60 px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{def.keyLabel}</div>
              <div className="mt-0.5 font-mono text-[11px] text-hud">{maskKey(storedKey)}</div>
            </div>
          )}
          {connectedAt && (
            <div className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.12em]">
              {t("connected")} {new Date(connectedAt).toLocaleString("en-GB", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      )}

      {/* Disconnected / error state — input form */}
      {!isConnected && !def.alwaysActive && (
        <div className="space-y-2">
          {/* Instructions for Telegram */}
          {def.instructions && (
            <div className="space-y-1">
              {def.instructions.map((line, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground">
                  <span className="hud-stat shrink-0 text-hud">{i + 1}.</span>
                  {line}
                  {i === 0 && botInfo?.username && (
                    <span className="font-mono text-hud">@{botInfo.username}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{def.keyLabel}</span>
              {def.keyHint && (
                <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
                  <Info className="h-2.5 w-2.5" />{def.keyHint}
                </span>
              )}
            </div>
            <input
              type={def.keyType === "password" ? "password" : "text"}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={def.keyPlaceholder}
              disabled={isBusy}
              className={`w-full border bg-transparent px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 transition-colors ${
                error
                  ? "border-threat/60 focus:border-threat"
                  : "border-border/60 focus:border-hud/60"
              }`}
            />
          </div>

          {/* Error */}
          {(error || isError) && (
            <div className="flex items-center gap-2 border border-threat/30 bg-threat/5 px-3 py-2 text-[10px] text-threat">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              {error || t("Connection error")}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {!def.alwaysActive && (
        <div className="mt-auto flex gap-2 pt-1">
          {isConnected ? (
            <button
              onClick={onDisconnect}
              disabled={isBusy}
              className="flex flex-1 items-center justify-center gap-2 border border-threat/50 bg-threat/5 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-threat hover:bg-threat/10 disabled:opacity-40 transition-colors"
            >
              {isDisconnecting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Link2Off className="h-3.5 w-3.5" />
              }
              {isDisconnecting ? t("Disconnecting…") : t("Disconnect")}
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={isBusy || !input.trim()}
              className="flex flex-1 items-center justify-center gap-2 border border-hud/50 bg-hud/8 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/15 disabled:opacity-40 transition-colors"
            >
              {isConnecting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Link2 className="h-3.5 w-3.5" />
              }
              {isConnecting ? t("Connecting…") : t("Connect")}
            </button>
          )}
        </div>
      )}
    </HudPanel>
  );
}

// ─── Status badge ─────────────────────────────────────────────
function StatusBadge({ state }: { state: ConnState }) {
  const { t } = useT();
  if (state === "connected") {
    return (
      <span className="flex shrink-0 items-center gap-1 border border-hud/50 bg-hud/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-hud">
        <CheckCircle className="h-2.5 w-2.5" /> {t("Active (badge)")}
      </span>
    );
  }
  if (state === "connecting" || state === "disconnecting") {
    return (
      <span className="flex shrink-0 items-center gap-1 border border-border px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        {state === "connecting" ? t("Connecting") : t("Disconnecting")}
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1 border border-threat/50 bg-threat/8 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-threat">
        <XCircle className="h-2.5 w-2.5" /> {t("Error (badge)")}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 border border-border/50 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
      <RefreshCw className="h-2.5 w-2.5" /> {t("Not connected")}
    </span>
  );
}
