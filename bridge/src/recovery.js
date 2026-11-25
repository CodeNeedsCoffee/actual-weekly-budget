// Recovery tracker: how far over budget the recovery period is, how much extra income has been
// applied, and how much is still left to recover.
//
// months: balancingMonths() output for balancingFrom..current month, in order. Every month except the
// last is complete; the last is the month in progress, so its extra income is not counted yet.
// used: applied extra income per month (from the balancing log).
export function recoverySummary({ months, used = {} }) {
  if (months.length === 0) return { months: [], totalExtra: 0, applied: 0, poolRemaining: 0, overspentNow: 0, leftToRecover: 0 };
  const rows = months.map((m, i) => ({
    month: m.month,
    complete: i < months.length - 1,
    extra: m.surplus,
    applied: used[m.month] ?? 0,
    // Balances already carry earlier months forward, so this is the running (cumulative) shortfall.
    overspent: m.cats.reduce((s, c) => s + (c.balance < 0 ? -c.balance : 0), 0),
  }));
  const complete = rows.filter((r) => r.complete);
  const totalExtra = complete.reduce((s, r) => s + r.extra, 0);
  const applied = rows.reduce((s, r) => s + r.applied, 0);
  const poolRemaining = Math.max(0, totalExtra - applied);
  const overspentNow = rows[rows.length - 1].overspent;
  return {
    months: rows,
    totalExtra,
    applied,
    poolRemaining,
    overspentNow,
    // What bonus money and transfers still have to cover after the unspent extra income is used.
    leftToRecover: Math.max(0, overspentNow - poolRemaining),
  };
}
