const STORAGE_KEY = "sg_notif_enabled";

export function isNotifEnabled(): boolean {
  return (
    "Notification" in window &&
    Notification.permission === "granted" &&
    localStorage.getItem(STORAGE_KEY) !== "false"
  );
}

export function setNotifEnabled(val: boolean) {
  localStorage.setItem(STORAGE_KEY, String(val));
}

export async function requestNotifPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

const LEVEL_ICONS: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

export function pushNotif(
  title: string,
  body: string,
  level: "low" | "medium" | "high" | "critical" = "medium",
) {
  if (!isNotifEnabled()) return;
  // Only push when the tab is hidden — no double-alert when user is watching
  if (document.visibilityState === "visible") return;

  const prefix = LEVEL_ICONS[level] ?? "•";
  new Notification(`${prefix} Sky Guardian — ${title}`, {
    body,
    tag: `sg-alert-${level}`, // collapses same-level alerts into one
    silent: true, // sounds.ts already handles audio
  });
}
