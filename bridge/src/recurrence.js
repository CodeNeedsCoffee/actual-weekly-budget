// Expands an Actual schedule date config into occurrence dates (YYYY-MM-DD).
// Supports one-time dates and daily/weekly/monthly/yearly with interval, weekend shifting,
// and end modes. Monthly patterns support numeric days and "last"; anything else is reported
// through `unsupported` so the caller can warn instead of guessing.

const DAY = 86400000;
const ms = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function shiftWeekend(date, cfg) {
  if (!cfg.skipWeekend) return date;
  const dow = new Date(ms(date)).getUTCDay();
  if (dow !== 0 && dow !== 6) return date;
  const back = cfg.weekendSolveMode === 'before';
  const delta = back ? (dow === 6 ? -1 : -2) : dow === 6 ? 2 : 1;
  return iso(ms(date) + delta * DAY);
}

function* raw(cfg) {
  const interval = cfg.interval ?? 1;
  const start = ms(cfg.start);
  const d0 = new Date(start);
  if (cfg.frequency === 'daily') {
    for (let t = start; ; t += interval * DAY) yield iso(t);
  } else if (cfg.frequency === 'weekly') {
    for (let t = start; ; t += interval * 7 * DAY) yield iso(t);
  } else if (cfg.frequency === 'monthly') {
    const patterns = cfg.patterns ?? [];
    for (let i = 0; ; i += interval) {
      const y = d0.getUTCFullYear() + Math.floor((d0.getUTCMonth() + i) / 12);
      const m = (d0.getUTCMonth() + i) % 12;
      const days = patterns.length
        ? patterns.map((p) => (p.value === 'last' ? dim(y, m) : Math.min(+p.value, dim(y, m)))).sort((a, b) => a - b)
        : [Math.min(d0.getUTCDate(), dim(y, m))];
      for (const day of days) {
        const t = Date.UTC(y, m, day);
        if (t >= start) yield iso(t);
      }
    }
  } else if (cfg.frequency === 'yearly') {
    for (let i = 0; ; i += interval) {
      const y = d0.getUTCFullYear() + i;
      yield iso(Date.UTC(y, d0.getUTCMonth(), Math.min(d0.getUTCDate(), dim(y, d0.getUTCMonth()))));
    }
  } else {
    throw new Error(`unknown frequency ${cfg.frequency}`);
  }
}

/** Occurrence dates within [from, to] inclusive. `dateCfg` is a date string or a config object. */
export function occurrences(dateCfg, from, to) {
  if (typeof dateCfg === 'string') {
    const d = dateCfg.slice(0, 10);
    return { dates: d >= from && d <= to ? [d] : [], unsupported: false };
  }
  const unsupported = (dateCfg.patterns ?? []).some((p) => p.type && p.type !== 'day');
  if (unsupported) return { dates: [], unsupported: true };
  const out = [];
  let n = 0;
  for (const base of raw(dateCfg)) {
    n += 1;
    if (dateCfg.endMode === 'after_n_occurrences' && n > (dateCfg.endOccurrences ?? 1)) break;
    if (dateCfg.endMode === 'on_date' && dateCfg.endDate && base > dateCfg.endDate) break;
    const d = shiftWeekend(base, dateCfg);
    if (base > to && d > to) break;
    if (d >= from && d <= to) out.push(d);
    if (n > 5000) break;
  }
  return { dates: out, unsupported: false };
}
