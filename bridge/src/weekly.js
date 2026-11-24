// Weekly budget math. Weeks run Sunday to Saturday. All money is integer cents,
// spent is a positive number, balance includes carryover from earlier months.

const DAY = 86400000;
const utc = (y, m, d) => Date.UTC(y, m, d);

function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return utc(y, m - 1, d);
}

export function iso(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

export function weekBounds(date) {
  const ms = parse(date);
  const start = ms - new Date(ms).getUTCDay() * DAY; // Sunday
  return { start: iso(start), end: iso(start + 6 * DAY) };
}

export function monthBounds(date) {
  const ms = parse(date);
  const d = new Date(ms);
  const first = utc(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const last = utc(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
  return { start: iso(first), end: iso(last) };
}

const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY) + 1; // inclusive

/**
 * @param {object} p
 * @param {string} p.today          YYYY-MM-DD
 * @param {number} p.balance        category balance today (cents), carryover included
 * @param {number} p.spentThisWeek  spent so far in this week within this month (cents, positive)
 */
export function weeklyPosition({ today, balance, spentThisWeek }) {
  const week = weekBounds(today);
  const month = monthBounds(today);
  const from = week.start > month.start ? week.start : month.start;
  const to = week.end < month.end ? week.end : month.end;
  const weekDays = daysBetween(from, to);
  const daysFromWeekStart = daysBetween(from, month.end);
  const balanceAtWeekStart = balance + spentThisWeek;
  const allowance =
    balanceAtWeekStart > 0 ? Math.round((balanceAtWeekStart * weekDays) / daysFromWeekStart) : 0;
  return {
    week,
    allowance,
    spentThisWeek,
    remainingThisWeek: allowance - spentThisWeek,
    monthRemaining: balance,
    overspent: balance < 0 ? -balance : 0,
  };
}
