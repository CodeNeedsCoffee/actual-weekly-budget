// Per-account sync freshness. Times are epoch milliseconds; `last_sync` from Actual is a string of ms.
export const STALE_HOURS = 48;

export function accountSyncStatus({ lastSync, latestTransaction }, nowMs, staleHours = STALE_HOURS) {
  const last = lastSync ? Number(lastSync) : null;
  const hoursAgo = last == null ? null : Math.max(0, Math.round(((nowMs - last) / 3600000) * 10) / 10);
  return {
    lastSync: last == null ? null : new Date(last).toISOString(),
    hoursAgo,
    latestTransaction: latestTransaction ?? null,
    stale: hoursAgo == null || hoursAgo > staleHours,
  };
}
