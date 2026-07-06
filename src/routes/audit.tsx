import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import { RefreshCw, Filter, Search, ChevronDown } from "lucide-react";
import { auditApi, type ApiAuditLog } from "@/lib/api";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/audit")({
  component: AuditLog,
  head: () => ({ meta: [{ title: "Audit Log // DDS" }] }),
});

// ─── Category definitions ─────────────────────────────────────
const CATEGORIES = [
  { value: "", label: "All" },
  { value: "auth", label: "Auth" },
  { value: "incident", label: "Incidents" },
  { value: "sensor", label: "Sensors" },
  { value: "mission", label: "Missions" },
  { value: "playbook", label: "Playbooks" },
  { value: "calibration", label: "Calibration" },
  { value: "alert", label: "Alerts" },
  { value: "sim", label: "Simulations" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

function matchesCategory(log: ApiAuditLog, cat: Category): boolean {
  if (!cat) return true;
  const action = log.action.toLowerCase();
  const resource = (log.resource ?? "").toLowerCase();
  if (cat === "auth")
    return resource.includes("auth") || action.includes("login") || action.includes("logout");
  if (cat === "sim") return action.startsWith("sim_");
  return resource.includes(cat);
}

function actionTone(action: string) {
  if (/fail|denied|deny|error/i.test(action)) return "text-threat";
  if (/warn|degraded|aborted/i.test(action)) return "text-warning";
  if (/pending/i.test(action)) return "text-info";
  return "text-hud";
}

// ─── Component ────────────────────────────────────────────────
function AuditLog() {
  const [logs, setLogs] = useState<ApiAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [showFilters, setShowFilters] = useState(false);
  const { t } = useT();

  async function load() {
    setLoading(true);
    setError("");
    try {
      setLogs(await auditApi.list(200));
    } catch {
      setError(t("Cannot reach server — showing last cached data"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Per-category counts (search-independent)
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of CATEGORIES) {
      map[c.value] = logs.filter((l) => matchesCategory(l, c.value)).length;
    }
    return map;
  }, [logs]);

  const filtered = useMemo(
    () =>
      logs.filter((l) => {
        if (!matchesCategory(l, category)) return false;
        if (!q) return true;
        const ql = q.toLowerCase();
        return (
          l.action.toLowerCase().includes(ql) ||
          (l.operatorName ?? "").toLowerCase().includes(ql) ||
          (l.resource ?? "").toLowerCase().includes(ql) ||
          (l.resourceId ?? "").toLowerCase().includes(ql)
        );
      }),
    [logs, category, q],
  );

  const activeLabel = CATEGORIES.find((c) => c.value === category)?.label ?? "All";
  const hasFilter = !!category || !!q;

  return (
    <div>
      <PageHeader
        title={t("Audit Log")}
        subtitle={t("Cryptographically signed action ledger · tamper-evident")}
        actions={
          <div className="flex items-center gap-2">
            {/* Active filter badge */}
            {category && (
              <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-hud">
                {t(activeLabel)}
              </span>
            )}

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                showFilters || hasFilter
                  ? "border-hud bg-hud/10 text-hud"
                  : "border-border text-muted-foreground hover:border-hud hover:text-hud"
              }`}
            >
              <Filter className="h-3 w-3" />
              {t("Filter")}
              <ChevronDown
                className={`h-3 w-3 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`}
              />
            </button>

            {/* Refresh */}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      <div className="px-4 py-4 sm:px-6">
        {error && <div className="mb-3 text-xs text-warning">{error}</div>}

        <HudPanel
          title={t("Action Trail")}
          subtitle={loading ? t("Loading…") : `${filtered.length} / ${logs.length} ${t("entries")}`}
          bodyClassName="p-0"
        >
          {/* ── Collapsible filter panel ───────────────────── */}
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <div className="space-y-2.5 border-b border-border bg-panel/20 px-4 py-3">
                {/* Search */}
                <div className="flex items-center gap-2 border border-border bg-input/20 px-3 py-1.5 focus-within:border-hud w-full max-w-sm">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t("Search action, actor, resource…")}
                    className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  {q && (
                    <button
                      onClick={() => setQ("")}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Category filter buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {CATEGORIES.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => {
                        setCategory(value);
                        setShowFilters(false);
                      }}
                      className={`flex items-center gap-1.5 border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                        category === value
                          ? "border-hud bg-hud/10 text-hud"
                          : "border-border text-muted-foreground hover:border-hud/60 hover:text-hud"
                      }`}
                    >
                      {t(label)}
                      <span
                        className={`border px-1 py-0.5 text-[9px] font-bold ${
                          category === value
                            ? "border-hud/40 text-hud"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {counts[value] ?? 0}
                      </span>
                    </button>
                  ))}

                  {hasFilter && (
                    <button
                      onClick={() => {
                        setCategory("");
                        setQ("");
                        setShowFilters(false);
                      }}
                      className="ml-auto text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-threat"
                    >
                      {t("✕ Clear")}
                    </button>
                  )}
                </div>

                {/* Count badge */}
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em]">
                  <span className="text-muted-foreground">{t("Showing")}</span>
                  <span className="border border-hud/40 bg-hud/5 px-1.5 py-0.5 font-bold text-hud">
                    {filtered.length}
                  </span>
                  <span className="text-muted-foreground">/ {logs.length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Table ─────────────────────────────────────── */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-xs">
            <thead className="bg-panel-elevated text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("Timestamp")}</th>
                <th className="px-3 py-2 text-left">{t("Actor")}</th>
                <th className="px-3 py-2 text-left">{t("Action")}</th>
                <th className="px-3 py-2 text-left">{t("Resource")}</th>
                <th className="px-3 py-2 text-left">{t("Target")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    {t("Loading…")}
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground"
                  >
                    {hasFilter
                      ? t("No entries match the current filter")
                      : t("No audit entries yet")}
                  </td>
                </tr>
              )}
              {filtered.map((l) => (
                <tr key={l.id} className="border-t border-border/40 hover:bg-hud/5">
                  <td className="hud-stat px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(l.timestamp).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" })}
                  </td>
                  <td className="px-3 py-2 font-bold">{l.operatorName ?? "System"}</td>
                  <td className={`hud-stat px-3 py-2 text-[11px] ${actionTone(l.action)}`}>
                    {l.action}
                  </td>
                  <td className="hud-stat px-3 py-2 text-[11px] text-muted-foreground">
                    {l.resource ?? "—"}
                  </td>
                  <td className="hud-stat px-3 py-2 text-[11px]">{l.resourceId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </HudPanel>
      </div>
    </div>
  );
}
