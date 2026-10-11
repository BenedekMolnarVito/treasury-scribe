/**
 * ProcessedNotifications.ts
 *
 * Idempotency guard for notification-shade polling.
 *
 * The native shade is a *snapshot*: re-polling it (cold start, app focus,
 * listener reconnect) returns the same notification until the user swipes it
 * away. The SQL dedup window (±seconds) only covers rapid re-delivery, so a
 * stale shade item re-polled minutes later would mint a duplicate transaction.
 *
 * This module tracks which shade items were already offered to the ingestion
 * pipeline, keyed on stable shade identity (package + title + body + post
 * time — a repost gets a new post time, hence a new key). Backed by
 * localStorage so it survives app restarts; entries expire after 7 days and
 * the set is capped at 500 entries to bound growth.
 */

export interface ShadeNotificationIdentity {
  packageName: string;
  title: string;
  body: string;
  postedAt: string;
}

interface StoredEntry {
  key: string;
  /** Epoch millis when the entry was recorded (for TTL pruning). */
  at: number;
}

const STORAGE_KEY = "treasuryScribe.processedShadeNotifications.v1";
const MAX_ENTRIES = 500;
const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Stable identity key for one shade item. Reposts get a new post time. */
export function shadeNotificationKey(n: ShadeNotificationIdentity): string {
  return JSON.stringify([n.packageName, n.title, n.body, n.postedAt]);
}

function readEntries(now: number): StoredEntry[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as StoredEntry[]).filter(
      (e) =>
        typeof e?.key === "string" &&
        typeof e?.at === "number" &&
        now - e.at < ENTRY_TTL_MS
    );
  } catch {
    return [];
  }
}

function writeEntries(entries: StoredEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Silently ignore (e.g., private browsing, quota exceeded).
  }
}

/** True when this exact shade item was already offered to ingestion. */
export function isShadeNotificationProcessed(
  n: ShadeNotificationIdentity,
  now: number = Date.now()
): boolean {
  const key = shadeNotificationKey(n);
  return readEntries(now).some((e) => e.key === key);
}

/**
 * Records a shade item as offered to ingestion. Safe to call for items the
 * SQL dedup dropped (an identical row exists) — a genuine repost carries a
 * new post time and therefore a different key.
 */
export function markShadeNotificationProcessed(
  n: ShadeNotificationIdentity,
  now: number = Date.now()
): void {
  const key = shadeNotificationKey(n);
  const entries = readEntries(now).filter((e) => e.key !== key);
  entries.unshift({ key, at: now });
  writeEntries(entries.slice(0, MAX_ENTRIES));
}
