import { planRebalance } from './rebalance.js';

// Savings sweep: move free budget into the Savings category.
// "Free" means spare money left after every overspent category has been covered (the rebalance
// comes first), so a sweep never competes with covering an overspent budget.
//
// months: same shape as planRebalance (cats carry isSavings / protected); the sweep is for the last month.
// amount: optional cents to sweep (capped at what is free); keep: cents to leave as a cushion when no amount is given.
export function planSweep({ months, amount = null, keep = 0 }) {
  const lastMonth = months[months.length - 1];
  const savings = lastMonth.cats.find((c) => c.isSavings);
  if (!savings) return { error: 'savings category not found' };
  const rb = planRebalance({ months, includeSavings: false });
  const free = rb.spare.reduce((s, x) => s + x.capacity, 0);
  const target = amount == null ? Math.max(0, free - keep) : Math.min(Math.max(0, amount), free);

  const takes = [];
  let left = target;
  for (const d of rb.spare) {
    if (left <= 0) break;
    const x = Math.min(d.capacity, left);
    takes.push({ categoryId: d.id, name: d.name, amount: x, from: d.budgeted });
    left -= x;
  }
  const total = takes.reduce((s, t) => s + t.amount, 0);
  const cells = takes.map((t) => ({ month: lastMonth.month, categoryId: t.categoryId, name: t.name, from: t.from, to: t.from - t.amount }));
  if (total > 0) cells.push({ month: lastMonth.month, categoryId: savings.id, name: savings.name, from: savings.budgeted, to: savings.budgeted + total });
  const stillOverspent = rb.overspentAfter[rb.overspentAfter.length - 1]?.amount ?? 0;
  return { month: lastMonth.month, free, total, takes, cells, stillOverspent };
}
