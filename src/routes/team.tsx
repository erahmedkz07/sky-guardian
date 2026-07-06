import { createFileRoute } from "@tanstack/react-router";
import { HudPanel, PageHeader } from "@/components/HudPanel";
import { useT } from "@/lib/i18n";
import {
  ChevronDown,
  Filter,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Users,
  UserCheck,
  ShieldAlert,
  Clock,
  X,
  Pencil,
  Check,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { teamApi, type ApiUser } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

export const Route = createFileRoute("/team")({
  component: Team,
  head: () => ({ meta: [{ title: "Team // DDS" }] }),
});

// ─── Constants ────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  admin:            "Admin",
  senior_operator:  "Senior Operator",
  operator:         "Operator",
  analyst:          "Analyst",
  viewer:           "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  admin:           "text-threat border-threat/40 bg-threat/8",
  senior_operator: "text-warning border-warning/40 bg-warning/8",
  operator:        "text-hud border-hud/40 bg-hud/8",
  analyst:         "text-purple-400 border-purple-400/40 bg-purple-400/8",
  viewer:          "text-muted-foreground border-border/50",
};

const CLEARANCE_COLORS: Record<string, string> = {
  "UNCLASSIFIED": "text-hud border-hud/40",
  "SECRET":       "text-warning border-warning/40",
  "TOP SECRET":   "text-threat border-threat/50",
};

const ROLES         = ["operator", "senior_operator", "analyst", "viewer", "admin"] as const;
const CLEARANCES    = ["UNCLASSIFIED", "SECRET", "TOP SECRET"] as const;
const CLEARANCE_LABEL = { "UNCLASSIFIED": "UNCLASSIFIED", "SECRET": "SECRET", "TOP SECRET": "TOP SECRET" };

function formatLastSeen(lastActive: string | null | undefined, lang: string): string {
  if (!lastActive) return "—";
  try {
    return formatDistanceToNow(new Date(lastActive), { addSuffix: true, locale: lang === "ru" ? ru : undefined });
  } catch { return "—"; }
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function getCurrentUser(): ApiUser | null {
  try { return JSON.parse(localStorage.getItem("dds_user") ?? "null"); }
  catch { return null; }
}

// ─── Custom HUD Modal ─────────────────────────────────────────
function HudModal({
  open, onClose, title, subtitle, children,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        ref={ref}
        className="relative z-10 w-full max-w-sm border border-hud/30 bg-background shadow-[0_0_40px_rgba(0,0,0,0.8)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-hud">{title}</div>
            {subtitle && (
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{subtitle}</div>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────
function InviteModal({
  open, onClose, onCreated,
}: {
  open: boolean; onClose: () => void; onCreated: (user: ApiUser) => void;
}) {
  const { t } = useT();
  const [name, setName]           = useState("");
  const [email, setEmail]         = useState("");
  const [role, setRole]           = useState<typeof ROLES[number]>("operator");
  const [clearance, setClearance] = useState<typeof CLEARANCES[number]>("SECRET");
  const [password, setPassword]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);

  function reset() {
    setName(""); setEmail(""); setRole("operator"); setClearance("SECRET");
    setPassword(""); setError(null); setSuccess(false); setLoading(false);
  }

  function handleClose() { reset(); onClose(); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const created = await teamApi.invite({ name, email, role, clearance, password });
      setSuccess(true);
      setTimeout(() => { onCreated(created); handleClose(); }, 1400);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("Failed to invite operator"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <HudModal open={open} onClose={handleClose} title={t("Add Operator")} subtitle={t("Register new team member")}>
      {success ? (
        <div className="flex items-center gap-3 px-5 py-8 text-hud">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <div>
            <div className="text-sm font-bold">{t("Operator added")}</div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-0.5">{t("Added to team")}</div>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="space-y-3 px-5 py-4">
            <HudField label={t("Full name")}>
              <HudInput
                value={name} onChange={setName}
                placeholder="Full Name" required autoFocus
              />
            </HudField>

            <HudField label="Email">
              <HudInput
                type="email" value={email} onChange={setEmail}
                placeholder="operator@dds.kz" required
              />
            </HudField>

            <HudField label={t("Role")}>
              <div className="grid grid-cols-3 gap-1">
                {ROLES.map((r) => (
                  <button
                    key={r} type="button"
                    onClick={() => setRole(r)}
                    className={`border py-1.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] transition-colors ${
                      role === r
                        ? ROLE_COLORS[r]
                        : "border-border/50 text-muted-foreground hover:border-hud/50 hover:text-hud"
                    }`}
                  >
                    {t(ROLE_LABELS[r] ?? r)}
                  </button>
                ))}
              </div>
            </HudField>

            <HudField label={t("Clearance")}>
              <div className="grid grid-cols-3 gap-1">
                {CLEARANCES.map((c) => (
                  <button
                    key={c} type="button"
                    onClick={() => setClearance(c)}
                    className={`border py-1.5 text-center text-[8px] font-bold uppercase tracking-[0.1em] transition-colors ${
                      clearance === c
                        ? `${CLEARANCE_COLORS[c]} bg-current/5`
                        : "border-border/50 text-muted-foreground hover:border-hud/50 hover:text-hud"
                    }`}
                  >
                    {t(CLEARANCE_LABEL[c])}
                  </button>
                ))}
              </div>
            </HudField>

            <HudField label={t("Temporary password")}>
              <HudInput
                type="password" value={password} onChange={setPassword}
                placeholder="••••••••" required minLength={6}
              />
            </HudField>

            {error && (
              <div className="flex items-center gap-2 border border-threat/30 bg-threat/8 px-3 py-2 text-[11px] text-threat">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
            <button
              type="button" onClick={handleClose}
              className="border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-hud/40 hover:text-foreground"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit" disabled={loading}
              className="flex items-center gap-2 border border-hud bg-hud/10 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? t("Creating…") : t("Create")}
            </button>
          </div>
        </form>
      )}
    </HudModal>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────
function DeleteModal({
  operator, onConfirm, onClose,
}: {
  operator: ApiUser | null; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useT();
  return (
    <HudModal open={!!operator} onClose={onClose} title={t("Remove Operator")} subtitle={t("This action is irreversible")}>
      <div className="px-5 py-4">
        <div className="border border-threat/30 bg-threat/5 p-3 text-sm">
          <span className="text-muted-foreground">{t("Remove")} </span>
          <span className="font-bold text-foreground">{operator?.name}</span>
          <span className="text-muted-foreground"> ({operator?.operatorId}) {t("from the roster? This action cannot be undone.")}</span>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
        <button
          onClick={onClose}
          className="border border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          {t("Cancel")}
        </button>
        <button
          onClick={onConfirm}
          className="border border-threat bg-threat/10 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-threat hover:bg-threat/20"
        >
          {t("Delete")}
        </button>
      </div>
    </HudModal>
  );
}

// ─── Inline Role Editor ───────────────────────────────────────
function RoleEditor({
  user, onUpdate,
}: {
  user: ApiUser; onUpdate: (updated: ApiUser) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [role, setRole]       = useState(user.role);

  async function save() {
    if (role === user.role) { setEditing(false); return; }
    setSaving(true);
    try {
      const updated = await teamApi.update(user.id, { role });
      onUpdate(updated);
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${ROLE_COLORS[user.role] ?? "text-muted-foreground border-border/50"}`}>
          {t(ROLE_LABELS[user.role] ?? user.role)}
        </span>
        <button onClick={() => setEditing(true)} className="text-muted-foreground/50 hover:text-hud transition-colors">
          <Pencil className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="border border-hud/40 bg-background px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-foreground focus:outline-none"
        autoFocus
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{t(ROLE_LABELS[r] ?? r)}</option>
        ))}
      </select>
      <button
        onClick={save} disabled={saving}
        className="border border-hud/50 p-0.5 text-hud hover:bg-hud/10 disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </button>
      <button onClick={() => { setRole(user.role); setEditing(false); }} className="text-muted-foreground hover:text-threat">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── HUD form helpers ─────────────────────────────────────────
function HudField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function HudInput({
  type = "text", value, onChange, placeholder, required, autoFocus, minLength,
}: {
  type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; autoFocus?: boolean; minLength?: number;
}) {
  return (
    <input
      type={type} value={value} required={required} autoFocus={autoFocus} minLength={minLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-hud/60 focus:outline-none"
    />
  );
}

// ─── Main Team Page ───────────────────────────────────────────
function Team() {
  const { t, lang } = useT();
  const [members, setMembers]       = useState<ApiUser[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [toDelete, setToDelete]     = useState<ApiUser | null>(null);
  const [removing, setRemoving]     = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const currentUser = getCurrentUser();
  const isAdmin       = currentUser?.role === "admin";
  const canInvite     = currentUser?.role === "admin" || currentUser?.role === "senior_operator";
  const canDelete     = isAdmin;
  const canEditRole   = isAdmin;
  const seeEmail      = isAdmin || currentUser?.role === "senior_operator";
  const seeFullDetails = isAdmin || currentUser?.role === "senior_operator";

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.operatorId.toLowerCase().includes(q) ||
          (seeEmail && m.email.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [members, roleFilter, search, seeEmail]);

  useEffect(() => {
    teamApi.list().then(setMembers).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleCreated = (user: ApiUser) => {
    setMembers((prev) => [...prev, user].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const handleUpdate = (updated: ApiUser) => {
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setRemoving(toDelete.id);
    setToDelete(null);
    try {
      await teamApi.remove(toDelete.id);
      setMembers((prev) => prev.filter((m) => m.id !== toDelete.id));
    } catch { /* ignore */ }
    setRemoving(null);
  };

  // KPI
  const online   = members.filter((m) => m.status === "online").length;
  const offline  = members.filter((m) => m.status !== "online").length;
  const admins   = members.filter((m) => m.role === "admin").length;

  return (
    <>
      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} onCreated={handleCreated} />
      <DeleteModal operator={toDelete} onConfirm={handleDelete} onClose={() => setToDelete(null)} />

      <div>
        <PageHeader
          title={t("Team Management")}
          subtitle={t("Roster · roles · access control")}
          actions={
            canInvite ? (
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center gap-2 border border-hud bg-hud/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-hud hover:bg-hud/20"
              >
                <Plus className="h-3.5 w-3.5" /> {t("Add Operator")}
              </button>
            ) : undefined
          }
        />

        {/* KPI row */}
        <div className="grid grid-cols-1 gap-3 px-4 py-4 sm:px-6 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={Users}      label={t("Total")}          value={String(members.length)} tone="hud" />
          <KpiCard icon={UserCheck}  label={t("Online")}         value={String(online)}         tone="hud" pulse />
          <KpiCard icon={Clock}      label={t("Offline (status)")} value={String(offline)}      tone="muted" />
          <KpiCard icon={ShieldAlert} label={t("Admins")}        value={String(admins)}         tone={admins > 1 ? "warning" : "hud"} />
        </div>

        {/* Role restriction banner for non-admins */}
        {!seeFullDetails && (
          <div className="mx-6 mb-3 flex items-center gap-2 border border-border/50 bg-muted/10 px-4 py-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            {t("Restricted view — full access for admins only")}
          </div>
        )}

        <div className="px-6 pb-6">
          <HudPanel
            title={t("Active Roster")}
            subtitle={
              loading
                ? t("loading…")
                : filteredMembers.length === members.length
                  ? `${members.length} ${t("members")}`
                  : `${filteredMembers.length} ${t("of")} ${members.length}`
            }
            bodyClassName="p-0"
            actions={
              !loading && members.length > 0 ? (
                <div className="flex items-center gap-2">
                  {(roleFilter !== "all" || search) && (
                    <span className="border border-hud/50 bg-hud/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-hud">
                      {roleFilter !== "all" ? t(ROLE_LABELS[roleFilter] ?? roleFilter) : t("search")}
                    </span>
                  )}
                  <button
                    onClick={() => setShowFilters((v) => !v)}
                    className={`flex items-center gap-1 border px-2 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                      showFilters ? "border-hud bg-hud/10 text-hud" : "border-border/60 text-muted-foreground hover:border-hud hover:text-hud"
                    }`}
                  >
                    <Filter className="h-2.5 w-2.5" />
                    {t("Filter")}
                    <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`} />
                  </button>
                </div>
              ) : undefined
            }
          >
            {/* Filter bar */}
            <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${showFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-panel/20 px-4 py-2.5">
                  {(["all", "operator", "senior_operator", "analyst", "viewer", "admin"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRoleFilter(r)}
                      className={`border px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] transition-colors ${
                        roleFilter === r ? "border-hud bg-hud/10 text-hud" : "border-border text-muted-foreground hover:border-hud hover:text-hud"
                      }`}
                    >
                      {r === "all" ? t("All") : t(ROLE_LABELS[r] ?? r)}
                      <span className={`ml-1 border px-1 text-[8px] font-bold ${roleFilter === r ? "border-hud/40 text-hud" : "border-border/50 text-muted-foreground"}`}>
                        {r === "all" ? members.length : members.filter((m) => m.role === r).length}
                      </span>
                    </button>
                  ))}
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("Search name / ID…")}
                    className="ml-2 w-44 border border-border bg-transparent px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-hud focus:outline-none"
                  />
                  {(roleFilter !== "all" || search) && (
                    <button
                      onClick={() => { setRoleFilter("all"); setSearch(""); }}
                      className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground hover:text-threat"
                    >
                      {t("✕ Clear")}
                    </button>
                  )}
                  <span className="ml-auto text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                    {t("Shown")} <span className="font-bold text-foreground">{filteredMembers.length}</span> / {members.length}
                  </span>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-hud" />
              </div>
            ) : members.length === 0 ? (
              <div className="px-4 py-12 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {t("No operators on roster")}
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {filteredMembers.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {t("No members match the current filter")}
                  </div>
                ) : (
                  filteredMembers.map((m) => {
                    const isMe = m.id === currentUser?.id;
                    const isOnline = m.status === "online";

                    return (
                      <div
                        key={m.id}
                        className={`flex items-center gap-4 px-4 py-3 hover:bg-hud/3 transition-colors ${isMe ? "bg-hud/5" : ""}`}
                      >
                        {/* Avatar */}
                        <div className={`relative flex h-9 w-9 shrink-0 overflow-hidden border text-[11px] font-bold tracking-wider ${
                          isOnline ? "border-hud/40 bg-hud/10 text-hud" : "border-border/40 bg-muted/20 text-muted-foreground"
                        }`}>
                          {m.avatarUrl ? (
                            <img src={m.avatarUrl} alt={m.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center">{initials(m.name)}</span>
                          )}
                        </div>

                        {/* Name + meta */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-bold ${isMe ? "text-hud" : "text-foreground"}`}>
                              {m.name}
                            </span>
                            {isMe && (
                              <span className="text-[9px] uppercase tracking-[0.15em] text-hud/70">{t("you")}</span>
                            )}
                            <span className="hud-stat text-[10px] text-muted-foreground/70">{m.operatorId}</span>
                          </div>

                          {seeEmail && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground/60">{m.email}</div>
                          )}
                        </div>

                        {/* Role */}
                        <div className="shrink-0 w-44">
                          {canEditRole && !isMe ? (
                            <RoleEditor user={m} onUpdate={handleUpdate} />
                          ) : (
                            <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${ROLE_COLORS[m.role] ?? "text-muted-foreground border-border/50"}`}>
                              {t(ROLE_LABELS[m.role] ?? m.role)}
                            </span>
                          )}
                        </div>

                        {/* Clearance */}
                        {seeFullDetails && (
                          <div className="shrink-0">
                            <span className={`border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] ${CLEARANCE_COLORS[m.clearance] ?? "text-muted-foreground border-border/50"}`}>
                              {t(CLEARANCE_LABEL[m.clearance as keyof typeof CLEARANCE_LABEL] ?? m.clearance)}
                            </span>
                          </div>
                        )}

                        {/* Status */}
                        <div className="shrink-0 flex items-center gap-1.5 w-28">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${isOnline ? "bg-hud animate-pulse" : "bg-muted-foreground/40"}`} />
                          <span className={`text-[10px] uppercase tracking-[0.15em] ${isOnline ? "text-hud" : "text-muted-foreground"}`}>
                            {isOnline ? t("online") : t("Offline (status)")}
                          </span>
                        </div>

                        {/* Last active */}
                        <div className="shrink-0 w-32 text-right">
                          <div className={`hud-stat text-[10px] ${isOnline ? "text-hud" : "text-muted-foreground"}`}>
                            {isOnline ? t("now") : formatLastSeen(m.lastActive, lang)}
                          </div>
                          {seeFullDetails && m.createdAt && (
                            <div className="mt-0.5 text-[9px] text-muted-foreground/50">
                              {new Date(m.createdAt).toLocaleDateString("en-GB", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "2-digit" })}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="shrink-0 w-6 text-right">
                          {removing === m.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
                          ) : canDelete && !isMe ? (
                            <button
                              onClick={() => setToDelete(m)}
                              className="text-muted-foreground/40 hover:text-threat transition-colors"
                              title="Удалить оператора"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </HudPanel>
        </div>
      </div>
    </>
  );
}

// ─── KPI card ─────────────────────────────────────────────────
function KpiCard({
  icon: Icon, label, value, tone, pulse,
}: {
  icon: typeof Users; label: string; value: string;
  tone: "hud" | "warning" | "muted"; pulse?: boolean;
}) {
  const color = tone === "hud" ? "text-hud" : tone === "warning" ? "text-warning" : "text-muted-foreground";
  return (
    <HudPanel bodyClassName="px-4 py-3 flex items-center gap-3">
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        <div className={`hud-stat text-2xl font-bold ${color} ${pulse ? "animate-pulse" : ""}`}>{value}</div>
      </div>
    </HudPanel>
  );
}
