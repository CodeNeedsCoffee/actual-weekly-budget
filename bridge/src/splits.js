// Build rule-style actions that split one transaction across categories.
// parts: [{ categoryId, percent? }]. Parts with a percent take that share of the total;
// exactly one part may omit percent and takes the remainder (default: the last part).
export function splitActions(parts) {
  if (!Array.isArray(parts) || parts.length < 2) throw new Error('need at least two parts');
  const open = parts.filter((p) => p.percent == null);
  if (open.length > 1) throw new Error('only one part may omit percent');
  const fixed = parts.reduce((s, p) => s + (p.percent ?? 0), 0);
  if (fixed > 100 || (open.length === 0 && Math.abs(fixed - 100) > 1e-9)) {
    throw new Error('percents must add up to 100');
  }
  const remainderIdx = open.length ? parts.indexOf(open[0]) : parts.length - 1;
  const actions = [];
  parts.forEach((p, i) => {
    if (!p.categoryId) throw new Error('every part needs a categoryId');
    const splitIndex = i + 1;
    const isRemainder = i === remainderIdx;
    actions.push({
      op: 'set-split-amount',
      value: isRemainder ? 1 : p.percent,
      options: { method: isRemainder ? 'remainder' : 'fixed-percent', splitIndex },
    });
    actions.push({ op: 'set', field: 'category', value: p.categoryId, options: { splitIndex } });
  });
  return actions;
}
