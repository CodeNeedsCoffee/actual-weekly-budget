// Zero-sum rebalancing: move budget from categories with spare balance to overspent ones.
// Money is integer cents. Savings (the `isSavings` category) is only used when allowed, and last.
//
// months: [{ month, cats: [{ id, name, budgeted, balance, carryover, isSavings?, protected? }] }] in order.
// A change to a category's budget in month m changes its balance in m and in every later month the
// carryover chain reaches (carryover on in month k carries k's balance into k+1).
export function planRebalance({ months, includeSavings = false }) {
  const idx = new Map(); // categoryId -> { name, isSavings, protected, bal[], co[], budget[], orig[] }
  months.forEach((m, mi) => {
    for (const c of m.cats) {
      if (!idx.has(c.id)) {
        idx.set(c.id, { id: c.id, name: c.name, isSavings: !!c.isSavings, protected: !!c.protected, bal: [], co: [], budget: [], orig: [] });
      }
      const r = idx.get(c.id);
      r.bal[mi] = c.balance;
      r.co[mi] = !!c.carryover;
      r.budget[mi] = c.budgeted;
      r.orig[mi] = c.budgeted;
    }
  });
  const rows = [...idx.values()];

  const shift = (r, mi, delta) => {
    for (let k = mi; k < months.length && r.bal[k] !== undefined; k++) {
      r.bal[k] += delta;
      if (!r.co[k]) break;
    }
  };
  // Most that can leave r's budget in month mi without overspending r then or in months it carries into.
  const capacity = (r, mi) => {
    let low = r.bal[mi];
    for (let k = mi; k < months.length - 1 && r.co[k] && r.bal[k + 1] !== undefined; k++) low = Math.min(low, r.bal[k + 1]);
    const byBudget = r.isSavings ? Infinity : r.budget[mi]; // only Savings may go below a zero budget
    return Math.max(0, Math.min(low, byBudget));
  };

  const moves = [];
  months.forEach((m, mi) => {
    const needers = rows.filter((r) => r.bal[mi] !== undefined && r.bal[mi] < 0).sort((a, b) => a.bal[mi] - b.bal[mi]);
    for (const need of needers) {
      for (const pass of includeSavings ? [false, true] : [false]) {
        let want = -need.bal[mi];
        if (want <= 0) break;
        const donors = rows
          .filter((d) => d !== need && d.bal[mi] !== undefined && !d.protected && d.isSavings === pass && !(pass === false && d.bal[mi] < 0))
          .map((d) => ({ d, cap: capacity(d, mi) }))
          .filter((x) => x.cap > 0)
          .sort((a, b) => b.cap - a.cap);
        for (const { d, cap } of donors) {
          if (want <= 0) break;
          const x = Math.min(want, cap);
          d.budget[mi] -= x;
          shift(d, mi, -x);
          need.budget[mi] += x;
          shift(need, mi, x);
          want -= x;
          moves.push({ month: m.month, fromId: d.id, from: d.name, toId: need.id, to: need.name, amount: x });
        }
      }
    }
  });

  const cells = [];
  months.forEach((m, mi) => {
    for (const r of rows) {
      if (r.orig[mi] !== undefined && r.budget[mi] !== r.orig[mi]) {
        cells.push({ month: m.month, categoryId: r.id, name: r.name, from: r.orig[mi], to: r.budget[mi] });
      }
    }
  });
  const overspentAfter = months.map((m, mi) => ({
    month: m.month,
    amount: rows.reduce((s, r) => s + (r.bal[mi] !== undefined && r.bal[mi] < 0 ? r.bal[mi] : 0), 0),
  }));
  // Money still free in the last month once every deficit the plan could cover is covered.
  const last = months.length - 1;
  const spare = rows
    .filter((r) => !r.isSavings && !r.protected && r.bal[last] !== undefined)
    .map((r) => ({ id: r.id, name: r.name, budgeted: r.orig[last], capacity: capacity(r, last) }))
    .filter((x) => x.capacity > 0)
    .sort((a, b) => b.capacity - a.capacity);
  return { moves, cells, total: moves.reduce((s, x) => s + x.amount, 0), overspentAfter, spare };
}
