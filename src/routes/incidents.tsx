import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useStore, createIncident, patchIncident } from "@/lib/store";
import { HudPanel, PageHeader, ThreatBadge } from "@/components/HudPanel";
import { format } from "date-fns";
import { RelativeTime } from "@/components/RelativeTime";
import {
  Plus, X, ChevronRight, AlertTriangle, Filter, ChevronDown,
  Edit2, ShieldAlert, CheckCircle2, User, Loader2,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Incident } from "@/lib/mockData";

export const Route = createFileRoute("/incidents")({
  component: Incidents,
  head: () => ({ meta: [{ title: "Incidents // DDS" }] }),
});

const STATUS_CYCLE: Record<string, Incident["status"]> = {
  open:          "investigating",
  investigating: "resolved",
  resolved:      "dismissed",
  dismissed:     "open",
};

const STATUS_LABEL_EN: Record<string, string> = {
  open:          "Investigate →",
  investigating: "Resolve →",
  resolved:      "Dismiss →",
  dismissed:     "Reopen →",
};

const STATUS_NAME_EN: Record<string, string> = {
  open:          "Open",
  investigating: "Investigating",
  resolved:      "Resolved",
  dismissed:     "Dismissed",
};

const THREAT_NAME_EN: Record<string, string> = {
  low:      "Low",
  medium:   "Medium",
  high:     "High",
  critical: "Critical",
};

const statusColor: Record<string, string> = {
  open:          "border-threat/50 bg-threat/10 text-threat",
  investigating: "border-warning/50 bg-warning/10 text-warning",
  resolved:      "border-hud/50 bg-hud/10 text-hud",
  dismissed:     "border-border text-muted-foreground",
};

const FILTER_KEYS: Record<string, string> = {
  all:          "All",
  open:         "Open",
  investigating:"Investigating",
  resolved:     "Resolved",
  dismissed:    "Dismissed",
};

// ─── Main component ───────────────────────────────────────────
function Incidents() {
  const { t } = useT();
  const incidents = useStore((s) => s.incidents);

  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<{ id: string; msg: string } | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Confirmation dialog state
  const [confirmAction, setConfirmAction] = useState<{
    inc: Incident;
    nextStatus: Incident["status"];
  } | null>(null);

  // Edit panel state
  const [editInc, setEditInc] = useState<Incident | null>(null);

  const filtered = filter === "all" ? incidents : incidents.filter((i) => i.status === filter);

  const counts = {
    open:          incidents.filter((i) => i.status === "open").length,
    investigating: incidents.filter((i) => i.status === "investigating").length,
    resolved:      incidents.filter((i) => i.status === "resolved").length,
    dismissed:     incidents.filter((i) => i.status === "dismissed").length,
  };

  const FILTER_OPTIONS = [
    { value: "all",          label: t("All"),           count: incidents.length },
    { value: "open",         label: t("Open"),          count: counts.open },
    { value: "investigating",label: t("Investigating"), count: counts.investigating },
    { value: "resolved",     label: t("Resolved"),      count: counts.resolved },
    { value: "dismissed",    label: t("Dismissed"),     count: counts.dismissed },
  ];

  function handleAdvanceClick(inc: Incident) {
    if (pending[inc.id]) return;
    setConfirmAction({ inc, nextStatus: STATUS_CYCLE[inc.status] });
  }

  async function handleAdvanceConfirm() {
    if (!confirmAction) return;
    const { inc, nextStatus } = confirmAction;
    setConfirmAction(null);
    setSaveError(null);
    setPending((p) => ({ ...p, [inc.id]: true }));
    try {
      await patchIncident(inc.id, { status: nextStatus });
    } catch (err) {
      setSaveError({
        id: inc.id,
        msg: err instanceof Error ? err.message : t("Server error — status not saved"),
      });
    } finally {
      setPending((p) => { const n = { ...p }; delete n[inc.id]; return n; });
    }
  }

  return (
    <div>
      <PageHeader
        title={t("Incidents")}
        subtitle={t("Incident tracker · response timer · accountability ledger")}
        actions={
          <div className="flex items-center gap-2">
            {filter !== "all" && (
              <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-hud">
                {t(FILTER_KEYS[filter] ?? filter)}
              </span>
            )}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 border px-3 py-2 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                showFilters
                  ? "border-hud bg-hud/10 text-hud"
                  : "border-border text-muted-foreground hover:border-hud hover:text-hud"
              }`}
            >
              <Filter className="h-3 w-3" />
              {t("Filter")}
              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-hud hover:bg-hud/20"
            >
              <Plus className="h-3.5 w-3.5" /> {t("Open Incident")}
            </button>
          </div>
        }
      />

      {/* Error banner */}
      {saveError && (
        <div className="mx-6 mt-3 flex items-center justify-between gap-3 border border-threat/50 bg-threat/10 px-4 py-2.5 text-xs text-threat">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span><span className="font-bold uppercase tracking-wider">{saveError.id}</span> — {saveError.msg}</span>
          </div>
          <button onClick={() => setSaveError(null)} className="text-threat/60 hover:text-threat">✕</button>
        </div>
      )}

      {/* Filter panel */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel/20 px-6 py-3">
            {FILTER_OPTIONS.map(({ value, label, count }) => (
              <button
                key={value}
                onClick={() => { setFilter(value); setShowFilters(false); }}
                className={`flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                  filter === value
                    ? "border-hud bg-hud/10 text-hud"
                    : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                }`}
              >
                {label}
                <span className={`border px-1 py-0.5 text-[9px] font-bold ${filter === value ? "border-hud/40 text-hud" : "border-border text-muted-foreground"}`}>
                  {count}
                </span>
              </button>
            ))}
            {filter !== "all" && (
              <button
                onClick={() => { setFilter("all"); setShowFilters(false); }}
                className="ml-auto text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-threat"
              >
                {t("✕ Clear")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-3 px-4 py-4 sm:px-6 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((inc) => (
          <IncidentCard
            key={inc.id}
            inc={inc}
            isBusy={!!pending[inc.id]}
            error={saveError?.id === inc.id ? saveError.msg : undefined}
            onAdvance={() => handleAdvanceClick(inc)}
            onEdit={() => setEditInc(inc)}
          />
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-xs text-muted-foreground uppercase tracking-[0.2em]">
            {t("No incidents matching filter")}
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmAction && (
        <ConfirmStatusDialog
          inc={confirmAction.inc}
          nextStatus={confirmAction.nextStatus}
          onConfirm={handleAdvanceConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Edit panel */}
      {editInc && (
        <EditIncidentPanel
          inc={editInc}
          onClose={() => setEditInc(null)}
        />
      )}

      {/* Create modal */}
      {showCreate && <CreateIncidentModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

// ─── Incident card ────────────────────────────────────────────
function IncidentCard({
  inc, isBusy, error, onAdvance, onEdit,
}: {
  inc: Incident;
  isBusy: boolean;
  error?: string;
  onAdvance: () => void;
  onEdit: () => void;
}) {
  const { t } = useT();
  return (
    <HudPanel className="h-full" bodyClassName="p-0 flex flex-col">
      <div className={`h-0.5 w-full ${
        inc.status === "open" ? "bg-threat"
        : inc.status === "investigating" ? "bg-warning"
        : inc.status === "resolved" ? "bg-hud"
        : "bg-border"
      }`} />

      <div className="flex flex-1 flex-col p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {inc.code} · {inc.id}
            </div>
            <h3 className="mt-1 text-sm font-bold uppercase tracking-wider text-foreground leading-snug line-clamp-2">
              {inc.title}
            </h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <ThreatBadge level={inc.threat} />
            <button
              onClick={onEdit}
              className="flex items-center gap-1 border border-border/50 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.15em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              <Edit2 className="h-2.5 w-2.5" />
              {t("Edit")}
            </button>
          </div>
        </div>

        {/* Description */}
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {inc.description || t("Description not provided.")}
        </p>

        {/* Meta */}
        <div className="mt-4 flex-1 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px]">
          <MetaField label={t("Assignee")}>
            <span className={`font-bold ${inc.assignee ? "" : "text-threat"}`}>
              {inc.assignee || t("⚠ Not assigned")}
            </span>
          </MetaField>
          <MetaField label={t("Created")}>
            <span className="hud-stat">{format(inc.createdAt, "dd.MM HH:mm")}</span>
          </MetaField>
          <MetaField label={t("Age")}>
            <span className="hud-stat text-warning">
              <RelativeTime date={inc.createdAt} addSuffix={false} />
            </span>
          </MetaField>
          <MetaField label={t("Status")}>
            <span className={`inline-block border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] ${statusColor[inc.status]}`}>
              {t(STATUS_NAME_EN[inc.status] ?? inc.status)}
            </span>
          </MetaField>
        </div>

        {/* Action button */}
        <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3">
          <button
            disabled={isBusy}
            onClick={onAdvance}
            className={`flex w-full items-center justify-center gap-1.5 border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors disabled:opacity-40 ${
              inc.status === "dismissed"
                ? "border-border text-muted-foreground hover:border-hud hover:text-hud"
                : "border-hud/60 text-hud hover:bg-hud/10"
            }`}
          >
            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            {isBusy ? t("Saving…") : t(STATUS_LABEL_EN[inc.status] ?? inc.status)}
          </button>
          {error && (
            <div className="flex items-center gap-1.5 text-[10px] text-threat">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </div>
    </HudPanel>
  );
}

// ─── Confirmation dialog ──────────────────────────────────────
function ConfirmStatusDialog({
  inc, nextStatus, onConfirm, onCancel,
}: {
  inc: Incident;
  nextStatus: Incident["status"];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const willInvestigate = nextStatus === "investigating";
  const noAssignee = !inc.assignee;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm border border-hud/40 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-bold tracking-widest text-hud text-[11px] uppercase">
            {t("Confirm Status Change")}
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Incident info */}
          <div className="border border-border/50 bg-panel/40 px-3 py-2.5 text-xs">
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-1">{inc.code}</div>
            <div className="font-bold text-foreground">{inc.title}</div>
          </div>

          {/* Transition */}
          <div className="flex items-center justify-center gap-3">
            <span className={`border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${statusColor[inc.status]}`}>
              {t(STATUS_NAME_EN[inc.status] ?? inc.status)}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className={`border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${statusColor[nextStatus]}`}>
              {t(STATUS_NAME_EN[nextStatus] ?? nextStatus)}
            </span>
          </div>

          {/* Warnings / info */}
          {noAssignee && (
            <div className="flex items-start gap-2 border border-threat/40 bg-threat/5 px-3 py-2 text-[11px] text-threat">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{t("No assignee set — recommend assigning before status change.")}</span>
            </div>
          )}

          {willInvestigate && (
            <div className="flex items-start gap-2 border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-warning">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{t("System alert sent to all operators. Map marker highlighted.")}</span>
            </div>
          )}

          {nextStatus === "resolved" && (
            <div className="flex items-start gap-2 border border-hud/40 bg-hud/5 px-3 py-2 text-[11px] text-hud">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{t("Incident closed — record saved to archive.")}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 border-t border-border pt-4">
            <button
              onClick={onCancel}
              className="flex-1 border border-border py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
            >
              {t("Cancel")}
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 border border-hud bg-hud/10 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20"
            >
              {t("Confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edit incident panel ──────────────────────────────────────
function EditIncidentPanel({ inc, onClose }: { inc: Incident; onClose: () => void }) {
  const { t } = useT();
  const [title, setTitle]     = useState(inc.title);
  const [threat, setThreat]   = useState<Incident["threat"]>(inc.threat);
  const [assignee, setAssignee] = useState(inc.assignee ?? "");
  const [desc, setDesc]       = useState(inc.description ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  async function handleSave() {
    setError("");
    if (!title.trim()) { setError(t("Title is required.")); return; }
    if (!assignee.trim()) { setError(t("Assignee is required. Provide full name.")); return; }
    setLoading(true);
    try {
      await patchIncident(inc.id, {
        title:       title.trim(),
        threat,
        assignee:    assignee.trim(),
        description: desc || undefined,
      });
      onClose();
    } catch {
      setError(t("Server error. Check connection."));
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-background/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="flex h-full w-full max-w-md flex-col border-l border-hud/30 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{inc.code}</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-hud">{t("Edit Incident")}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Status (read-only info) */}
          <div className="flex items-center gap-2 border border-border/40 bg-panel/30 px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Current status:")}</div>
            <span className={`border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${statusColor[inc.status]}`}>
              {t(STATUS_NAME_EN[inc.status] ?? inc.status)}
            </span>
            <ThreatBadge level={inc.threat} />
          </div>

          {/* Title */}
          <Field label={t("Title *")}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-border bg-transparent px-3 py-2 text-xs focus:border-hud focus:outline-none"
            />
          </Field>

          {/* Threat */}
          <Field label={t("Threat Level")}>
            <div className="flex gap-2">
              {(["low", "medium", "high", "critical"] as const).map((tl) => (
                <button
                  key={tl}
                  type="button"
                  onClick={() => setThreat(tl)}
                  className={`flex-1 border py-1.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${
                    threat === tl
                      ? tl === "critical" ? "border-threat bg-threat/20 text-threat"
                      : tl === "high"     ? "border-threat/70 bg-threat/10 text-threat/80"
                      : tl === "medium"   ? "border-warning bg-warning/20 text-warning"
                      :                     "border-hud bg-hud/20 text-hud"
                      : "border-border text-muted-foreground hover:border-hud"
                  }`}
                >
                  {t(THREAT_NAME_EN[tl] ?? tl)}
                </button>
              ))}
            </div>
          </Field>

          {/* Assignee — required */}
          <Field label={t("Assignee (full name) *")}>
            <div className="flex items-center gap-2 border border-border bg-transparent px-3 py-2 focus-within:border-hud">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="Ivan Ivanov"
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
            {!assignee.trim() && (
              <div className="mt-1 text-[10px] text-threat">{t("Required field")}</div>
            )}
          </Field>

          {/* Description */}
          <Field label={t("Description")}>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              placeholder={t("Describe the incident…")}
              className="w-full border border-border bg-transparent px-3 py-2 text-xs focus:border-hud focus:outline-none resize-none"
            />
          </Field>

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-3 border-t border-border/40 pt-3">
            <div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Created")}</div>
              <div className="mt-0.5 font-mono text-[10px] text-foreground/70">{format(inc.createdAt, "dd.MM.yyyy HH:mm")}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("Last Updated")}</div>
              <div className="mt-0.5 font-mono text-[10px] text-foreground/70">{format(inc.updatedAt, "dd.MM.yyyy HH:mm")}</div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 border border-threat/40 bg-threat/5 px-3 py-2 text-[11px] text-threat">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="flex-1 border border-border py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud hover:text-hud"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 border border-hud bg-hud/10 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
          >
            {loading ? t("Saving...") : t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create incident modal ────────────────────────────────────
function CreateIncidentModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const currentUserName = (() => {
    try { return JSON.parse(localStorage.getItem("dds_user") ?? "null")?.name ?? ""; }
    catch { return ""; }
  })();

  const [title, setTitle]     = useState("");
  const [threat, setThreat]   = useState<"low" | "medium" | "high" | "critical">("medium");
  const [desc, setDesc]       = useState("");
  const [assignee, setAssignee] = useState(currentUserName);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim())    { setError(t("Title is required.")); return; }
    if (!assignee.trim()) { setError(t("Assignee is required. Provide full name.")); return; }
    setLoading(true);
    try {
      await createIncident({ title: title.trim(), threat, description: desc || undefined, assignee: assignee.trim() });
      onClose();
    } catch {
      setError(t("Failed to create incident. Check server connection."));
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md border border-hud/40 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-bold tracking-widest text-hud text-[11px] uppercase">{t("Open New Incident")}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <Field label={t("Title *")}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("PERIMETER BREACH · GRID 14-C")}
              className="w-full border border-border bg-transparent px-3 py-2 text-xs focus:border-hud focus:outline-none"
            />
          </Field>

          <Field label={t("Threat Level")}>
            <div className="flex gap-2">
              {(["low", "medium", "high", "critical"] as const).map((tl) => (
                <button
                  key={tl}
                  type="button"
                  onClick={() => setThreat(tl)}
                  className={`flex-1 border py-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    threat === tl
                      ? tl === "critical" ? "border-threat bg-threat/20 text-threat"
                      : tl === "high"     ? "border-threat/70 bg-threat/10 text-threat/80"
                      : tl === "medium"   ? "border-warning bg-warning/20 text-warning"
                      :                     "border-hud bg-hud/20 text-hud"
                      : "border-border text-muted-foreground hover:border-hud"
                  }`}
                >
                  {t(THREAT_NAME_EN[tl] ?? tl)}
                </button>
              ))}
            </div>
          </Field>

          {/* Assignee — required */}
          <Field label={t("Assignee (full name) *")}>
            <div className="flex items-center gap-2 border border-border bg-transparent px-3 py-2 focus-within:border-hud">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="Ivan Ivanov"
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
          </Field>

          <Field label={t("Description")}>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder={t("Describe the incident…")}
              className="w-full border border-border bg-transparent px-3 py-2 text-xs focus:border-hud focus:outline-none resize-none"
            />
          </Field>

          {error && (
            <div className="flex items-center gap-2 border border-threat/40 bg-threat/5 px-3 py-2 text-[11px] text-threat">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

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
              disabled={loading}
              className="flex-1 border border-hud bg-hud/10 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
            >
              {loading ? t("Creating...") : t("Create Incident")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
