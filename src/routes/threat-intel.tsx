import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HudPanel, PageHeader, ThreatBadge } from "@/components/HudPanel";
import {
  ShieldAlert,
  Plus,
  X,
  Loader2,
  RefreshCw,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Filter,
  Info,
  Database,
  Search,
  Radar,
  GitBranch,
} from "lucide-react";
import { threatIntelApi, type ApiThreatIntel } from "@/lib/api";
import { format } from "date-fns";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/threat-intel")({
  component: ThreatIntel,
  head: () => ({ meta: [{ title: "Threat Intel // DDS" }] }),
});

const ABOUT_KEY = "dds_threatintel_about_dismissed";

const PATTERNS = [
  "Cluster ingress at dawn (04:00-06:00) — 73% correlation",
  "RF jamming precedes 41% of high-threat incursions",
  "Loitering at 250 m altitude common to Shahed class",
  "Bird-strike false-positives spike during migration windows",
  "Repeated approach vectors from grid 14-C across 9 incidents",
];

const IOC_FEEDS = [
  { name: "NORAD CUAS feed", status: "SYNCED" },
  { name: "IntelDrone OSINT", status: "SYNCED" },
  { name: "Local SIGINT relay", status: "SYNCED" },
];

const THREAT_LEVELS = ["all", "critical", "high", "medium", "low", "verified"] as const;
type LevelFilter = (typeof THREAT_LEVELS)[number];

function ThreatIntel() {
  const { t } = useT();
  const [list, setList] = useState<ApiThreatIntel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAbout, setShowAbout] = useState(() => !localStorage.getItem(ABOUT_KEY));

  async function load() {
    setLoading(true);
    try {
      setList(await threatIntelApi.list());
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function dismissAbout() {
    localStorage.setItem(ABOUT_KEY, "1");
    setShowAbout(false);
  }

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onCreated(entry: ApiThreatIntel) {
    setList((prev) => [entry, ...prev]);
    setModal(false);
  }

  const filtered =
    levelFilter === "all"
      ? list
      : levelFilter === "verified"
        ? list.filter((i) => i.verified)
        : list.filter((i) => i.threatLevel === levelFilter);

  const stats = {
    critical: list.filter((i) => i.threatLevel === "critical").length,
    high: list.filter((i) => i.threatLevel === "high").length,
    verified: list.filter((i) => i.verified).length,
    total: list.length,
  };

  const activeLabel =
    levelFilter === "all" ? null : (THREAT_LEVELS.find((v) => v === levelFilter) ?? null);

  return (
    <div>
      <PageHeader
        title={t("Threat Intelligence")}
        subtitle={t("Adversary catalogue · pattern recognition · IOC registry")}
        actions={
          <div className="flex items-center gap-2">
            {!showAbout && (
              <button
                onClick={() => setShowAbout(true)}
                className="flex items-center gap-1.5 border border-border px-2 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
              >
                <Info className="h-3 w-3" /> {t("About")}
              </button>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> {t("Refresh")}
            </button>
            <button
              onClick={() => setModal(true)}
              className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-hud hover:bg-hud/20"
            >
              <Plus className="h-3.5 w-3.5" /> {t("New Intel")}
            </button>
          </div>
        }
      />

      {/* About banner */}
      {showAbout && (
        <div className="mx-6 mt-3 border border-hud/30 bg-hud/5">
          <div className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-hud" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-hud">
                {t("What is Threat Intelligence?")}
              </span>
            </div>
            <button
              onClick={dismissAbout}
              className="mt-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="px-5 pb-3 text-[11px] leading-relaxed text-muted-foreground">
            {t(
              "This module aggregates intelligence reports from multiple sources — field operators, SIGINT relays, OSINT feeds, and AI pattern analysis — into a unified adversary picture. Each entry describes a known or suspected threat: a drone model, attack vector, RF signature, or behavioral pattern. Verified entries are cross-referenced with live detections to generate alerts.",
            )}
          </p>
          <div className="grid grid-cols-2 gap-px border-t border-border/40 bg-border/20 lg:grid-cols-4">
            {[
              {
                icon: Database,
                title: "Adversary Catalogue",
                body: "Drone models, RF signatures, payload types, and known operators.",
              },
              {
                icon: Search,
                title: "IOC Registry",
                body: "Indicators of Compromise — flight paths, MAC addresses, frequency bands.",
              },
              {
                icon: Radar,
                title: "Pattern Recognition",
                body: "AI-correlated attack vectors, timing patterns, and cluster analysis.",
              },
              {
                icon: GitBranch,
                title: "Verification Chain",
                body: "Source attribution and confidence scoring across intel entries.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-background/40 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3 w-3 text-hud" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-hud">
                    {t(title)}
                  </span>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  {t(body)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI row */}
      {!loading && list.length > 0 && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-2 pt-4 sm:px-6 lg:grid-cols-4">
          {[
            { label: "Total entries", value: stats.total, tone: "text-hud" },
            { label: "Critical threats", value: stats.critical, tone: "text-threat" },
            { label: "High threats", value: stats.high, tone: "text-warning" },
            { label: "Verified", value: stats.verified, tone: "text-hud" },
          ].map((s) => (
            <div key={s.label} className="hud-panel px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {t(s.label)}
              </div>
              <div className={`hud-stat mt-0.5 text-2xl font-bold ${s.tone}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 px-6 py-4 lg:grid-cols-[2fr_1fr]">
        {/* Intel Reports */}
        <HudPanel
          title={t("Intel Reports")}
          subtitle={
            loading ? t("Loading…") : `${filtered.length} ${t("of")} ${list.length} ${t("entries")}`
          }
          bodyClassName="p-0"
          actions={
            !loading && list.length > 0 ? (
              <div className="flex items-center gap-2">
                {activeLabel && (
                  <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-hud">
                    {t(activeLabel)}
                  </span>
                )}
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className={`flex items-center gap-1 border px-2 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                    showFilters
                      ? "border-hud bg-hud/10 text-hud"
                      : "border-border/60 text-muted-foreground hover:border-hud hover:text-hud"
                  }`}
                >
                  <Filter className="h-2.5 w-2.5" />
                  {t("Filter")}
                  <ChevronDown
                    className={`h-2.5 w-2.5 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
            ) : undefined
          }
        >
          {/* Collapsible filter bar */}
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-panel/20 px-4 py-2.5">
                {THREAT_LEVELS.map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      setLevelFilter(v);
                      setShowFilters(false);
                    }}
                    className={`border px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                      levelFilter === v
                        ? "border-hud bg-hud/10 text-hud"
                        : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                    }`}
                  >
                    {t(v)}
                    <span
                      className={`ml-1 border px-1 text-[8px] font-bold ${
                        levelFilter === v
                          ? "border-hud/40 text-hud"
                          : "border-border/50 text-muted-foreground"
                      }`}
                    >
                      {v === "all"
                        ? list.length
                        : v === "verified"
                          ? stats.verified
                          : v === "critical"
                            ? stats.critical
                            : v === "high"
                              ? stats.high
                              : list.filter((i) => i.threatLevel === v).length}
                    </span>
                  </button>
                ))}
                {levelFilter !== "all" && (
                  <button
                    onClick={() => {
                      setLevelFilter("all");
                      setShowFilters(false);
                    }}
                    className="ml-auto text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-threat"
                  >
                    {t("✕ Clear")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-hud" />
            </div>
          )}

          {/* Empty */}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {list.length === 0
                ? t("No intel records in database")
                : `${t("No entries match filter")} "${t(levelFilter)}"`}
            </div>
          )}

          {/* Expandable rows */}
          {!loading && filtered.length > 0 && (
            <div className="divide-y divide-border/40">
              {filtered.map((item) => {
                const isOpen = expanded.has(item.id);
                const threatColor =
                  item.threatLevel === "critical"
                    ? "bg-threat"
                    : item.threatLevel === "high"
                      ? "bg-orange-500"
                      : item.threatLevel === "medium"
                        ? "bg-warning"
                        : "bg-hud";
                return (
                  <div key={item.id}>
                    {/* Row header — always visible */}
                    <button
                      onClick={() => toggleRow(item.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hud/5"
                    >
                      {/* Threat level accent */}
                      <div className={`h-8 w-0.5 shrink-0 ${threatColor}`} />

                      {/* Chevron */}
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                      />

                      {/* Title + source */}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold uppercase tracking-wider text-foreground">
                          {item.title}
                        </div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                          {item.source}
                          {item.summary && !isOpen && (
                            <span className="ml-2 text-muted-foreground/60">
                              · {item.summary.slice(0, 60)}
                              {item.summary.length > 60 ? "…" : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Meta badges */}
                      <div className="flex shrink-0 items-center gap-2">
                        {item.verified && <CheckCircle className="h-3.5 w-3.5 text-hud" />}
                        <ThreatBadge
                          level={item.threatLevel as "low" | "medium" | "high" | "critical"}
                        />
                        <span className="hud-stat text-[10px] text-muted-foreground">
                          {item.createdAt ? format(new Date(item.createdAt), "MM-dd") : "—"}
                        </span>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    <div
                      className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                    >
                      <div className="overflow-hidden">
                        <div className="border-t border-border/30 bg-hud/3 px-4 py-4">
                          {/* Summary */}
                          {item.summary && (
                            <p className="mb-4 border-l-2 border-hud/40 pl-3 text-[11px] leading-relaxed text-muted-foreground">
                              {item.summary}
                            </p>
                          )}

                          {/* Detail grid */}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[11px] sm:grid-cols-4">
                            <DetailField label={t("Source")} value={item.source} />
                            <DetailField
                              label={t("Threat")}
                              value={item.threatLevel.toUpperCase()}
                            />
                            <DetailField
                              label={t("Verified")}
                              value={item.verified ? t("Yes — confirmed") : t("Unverified")}
                              tone={item.verified ? "hud" : undefined}
                            />
                            <DetailField
                              label={t("Logged")}
                              value={
                                item.createdAt
                                  ? format(new Date(item.createdAt), "MMM dd, HH:mm")
                                  : "—"
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </HudPanel>

        {/* Right sidebar */}
        <div className="space-y-3">
          <HudPanel
            title={t("Behavioral Patterns")}
            actions={<ShieldAlert className="h-4 w-4 text-warning" />}
          >
            <div className="space-y-2">
              {PATTERNS.map((p) => (
                <div
                  key={p}
                  className="flex gap-2 border-l-2 border-hud/60 bg-hud/5 px-3 py-2 text-[11px]"
                >
                  <span className="mt-px shrink-0 text-hud">›</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </HudPanel>

          <HudPanel title={t("IOC Feed Status")}>
            <div className="space-y-2 text-xs">
              {IOC_FEEDS.map(({ name, status }) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{name}</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-hud">
                    <span className="h-1.5 w-1.5 rounded-full bg-hud blink-pulse" />
                    {t(status)}
                  </span>
                </div>
              ))}
            </div>
          </HudPanel>

          <HudPanel title={t("How to Use")}>
            <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                › <span className="font-bold text-foreground">{t("Browse")}</span>{" "}
                {t("the intel catalogue and click any row to read the full summary.")}
              </p>
              <p>
                › <span className="font-bold text-foreground">{t("Filter")}</span>{" "}
                {t("by threat level or verification status to focus on priority items.")}
              </p>
              <p>
                › <span className="font-bold text-foreground">{t("Submit")}</span>{" "}
                {t(
                  'field intelligence via "New Intel" — unverified entries await operator review.',
                )}
              </p>
              <p>
                › <span className="font-bold text-foreground">{t("Cross-reference")}</span>{" "}
                {t("entries with live detection feed to confirm active threats.")}
              </p>
            </div>
          </HudPanel>
        </div>
      </div>

      {modal && <NewIntelModal onClose={() => setModal(false)} onCreated={onCreated} />}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────
function NewIntelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (entry: ApiThreatIntel) => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [threatLevel, setThreatLevel] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [summary, setSummary] = useState("");
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !source.trim()) {
      setErr(t("Title and source are required"));
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const created = await threatIntelApi.create({
        title: title.trim(),
        source: source.trim(),
        threatLevel,
        summary: summary.trim() || undefined,
        verified,
      });
      onCreated(created);
    } catch {
      setErr(t("Failed to create intel entry — check server connection."));
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg border border-hud/40 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-bold tracking-widest text-hud">{t("New Intel Entry")}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <ModalField label={t("Title *")}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Shahed-136 spotted near grid 14-C"
              className="w-full border border-border bg-transparent px-3 py-2 text-xs focus:border-hud focus:outline-none"
            />
          </ModalField>

          <ModalField label={t("Source *")}>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. SIGINT-7 · NORAD · Field Report"
              className="w-full border border-border bg-transparent px-3 py-2 text-xs focus:border-hud focus:outline-none"
            />
          </ModalField>

          <ModalField label={t("Threat Level")}>
            <div className="flex gap-2">
              {(["low", "medium", "high", "critical"] as const).map((tl) => (
                <button
                  key={tl}
                  type="button"
                  onClick={() => setThreatLevel(tl)}
                  className={`flex-1 border py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    threatLevel === tl
                      ? tl === "critical"
                        ? "border-threat bg-threat/20 text-threat"
                        : tl === "high"
                          ? "border-orange-500/70 bg-orange-500/10 text-orange-400"
                          : tl === "medium"
                            ? "border-warning bg-warning/20 text-warning"
                            : "border-hud bg-hud/20 text-hud"
                      : "border-border text-muted-foreground hover:border-hud"
                  }`}
                >
                  {t(tl)}
                </button>
              ))}
            </div>
          </ModalField>

          <ModalField label={t("Summary")}>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder="Intelligence summary, context, and indicators…"
              className="w-full resize-none border border-border bg-transparent px-3 py-2 text-xs focus:border-hud focus:outline-none"
            />
          </ModalField>

          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="accent-[var(--hud)]"
            />
            <span>{t("Mark as verified (source confirmed)")}</span>
          </label>

          {err && <div className="text-[11px] text-threat">{err}</div>}

          <div className="flex gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-border py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 border border-hud bg-hud/10 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("Saving…")}
                </span>
              ) : (
                t("Save Intel")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────
function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function DetailField({ label, value, tone }: { label: string; value: string; tone?: "hud" }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-[11px] font-bold ${tone === "hud" ? "text-hud" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}
