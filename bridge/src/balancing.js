// Extra-income pool planner. All money is integer cents.
//
// months: [{ month: 'YYYY-MM', surplus, cats: [{ id, name, budgeted, balance, carryover }] }] in order.
//   surplus = income received minus the income base for that month (negative = shortfall).
// used: { 'YYYY-MM': cents } extra income already allocated in earlier applies.
//
// Each month adds its surplus to a running pool (shortfalls subtract), then covers the month's most
// overspent categories, biggest deficit first and never more than the deficit. Money added to a
// category carries into later months only where that category's carryover flag is on.
export function planExtraIncome({ months, used = {} }) {
  const cells = [];
  const out = [];
  let pool = 0;
  let carry = new Map(); // categoryId -> cents added earlier in this plan that carries forward

  for (const m of months) {
    pool += m.surplus - (used[m.month] ?? 0);
    const eff = new Map(m.cats.map((c) => [c.id, c.balance + (carry.get(c.id) ?? 0)]));
    let available = Math.max(pool, 0);
    const moves = [];
    const order = [...m.cats].sort((a, b) => eff.get(a.id) - eff.get(b.id));
    for (const c of order) {
      const bal = eff.get(c.id);
      if (bal >= 0 || available <= 0) continue;
      const add = Math.min(-bal, available);
      available -= add;
      pool -= add;
      eff.set(c.id, bal + add);
      moves.push({ categoryId: c.id, name: c.name, add });
      cells.push({ month: m.month, categoryId: c.id, name: c.name, from: c.budgeted, to: c.budgeted + add });
    }
    const nextCarry = new Map();
    for (const c of m.cats) {
      const total = (carry.get(c.id) ?? 0) + (moves.find((x) => x.categoryId === c.id)?.add ?? 0);
      if (c.carryover && total) nextCarry.set(c.id, total);
    }
    carry = nextCarry;
    const overspentAfter = [...eff.values()].filter((v) => v < 0).reduce((s, v) => s + v, 0);
    out.push({
      month: m.month,
      surplus: m.surplus,
      used: used[m.month] ?? 0,
      allocated: moves.reduce((s, x) => s + x.add, 0),
      poolAfter: pool,
      overspentAfter,
      moves,
    });
  }
  return { months: out, cells, totalAllocated: cells.reduce((s, c) => s + (c.to - c.from), 0) };
}

/** Stable id for a set of cells so apply can confirm it is applying exactly what was previewed. */
export function planId(cells) {
  const text = cells.map((c) => `${c.month}|${c.categoryId}|${c.from}|${c.to}`).join(';');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
