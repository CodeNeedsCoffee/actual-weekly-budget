import { occurrences } from './recurrence.js';

const DAY = 86400000;
const ms = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => iso(ms(d) + n * DAY);
const APPROX = 0.075; // Actual treats "approximately" as +/- 7.5%

/**
 * Cents for a schedule amount. mode 'worst' (default): bigger outflow, smaller inflow, so a bounce is
 * never understated. mode 'expected': the stated amount, or the midpoint of a range.
 */
export function worstCase(amount, op, mode = 'worst') {
  if (op === 'isbetween' && amount && typeof amount === 'object') {
    return mode === 'expected' ? Math.round((amount.num1 + amount.num2) / 2) : Math.min(amount.num1, amount.num2);
  }
  const n = typeof amount === 'object' ? amount.num1 : amount;
  if (mode === 'worst' && op === 'isapprox') return Math.round(n < 0 ? n * (1 + APPROX) : n * (1 - APPROX));
  return n;
}

function adjustmentDates(item, from, to) {
  const out = [];
  for (let t = ms(from); t <= ms(to); t += DAY) {
    const d = new Date(t);
    const days = [].concat(item.dayOfMonth);
    const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (days.some((x) => Math.min(x, dim) === d.getUTCDate())) out.push(iso(t));
  }
  return out;
}

/**
 * @param {object} p
 * @param {string} p.today
 * @param {number} p.days
 * @param {number} p.checkingBalance cents
 * @param {number} [p.savingsBalance] cents
 * @param {string} p.checkingId
 * @param {Array}  p.schedules  [{ id, name, accountId, amount, op, dateCfg, nextDate, completed }]
 * @param {{variablePerDay?: number, items?: Array}} [p.adjustments] estimates for things Actual has no schedule for
 * @param {number} [p.buffer] cents to keep in Checking
 */
export function forecast({ today, days = 14, checkingBalance, savingsBalance = 0, checkingId, schedules, adjustments = {}, buffer = 100000, amountMode = 'worst', incomeDelayDays = 0 }) {
  const end = addDays(today, days);
  const events = []; // { date, name, amount, kind: 'bill' | 'income' | 'estimate' }
  const cardItems = [];
  const warnings = [];

  for (const s of schedules) {
    if (s.completed) continue;
    const { dates, unsupported } = occurrences(s.dateCfg, s.nextDate && s.nextDate < today ? s.nextDate : today, end);
    if (unsupported) warnings.push(`Schedule "${s.name}" uses a repeat pattern the forecast cannot read`);
    const amount = worstCase(s.amount, s.op, amountMode);
    for (const d of dates) {
      // Occurrences before the schedule's next date were already posted.
      if (s.nextDate && d < s.nextDate) continue;
      const date = d < today ? today : d;
      const ev = { date, name: s.name, amount, kind: amount > 0 ? 'income' : 'bill', scheduleId: s.id };
      if (s.accountId === checkingId) events.push(ev);
      else cardItems.push(ev);
    }
  }
  for (const item of adjustments.items ?? []) {
    for (const d of adjustmentDates(item, addDays(today, 1), end)) {
      const income = item.amount > 0;
      const date = income && incomeDelayDays ? addDays(d, incomeDelayDays) : d;
      if (date <= end) events.push({ date, name: item.name, amount: item.amount, kind: income ? 'income' : 'estimate' });
    }
  }

  const path = [];
  let withIncome = checkingBalance;
  let without = checkingBalance;
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const items = events.filter((e) => e.date === date);
    for (const e of items) {
      withIncome += e.amount;
      if (e.kind !== 'income') without += e.amount;
    }
    if (i > 0 && adjustments.variablePerDay) {
      withIncome -= adjustments.variablePerDay;
      without -= adjustments.variablePerDay;
    }
    path.push({ date, items, balanceWith: withIncome, balanceWithout: without });
  }

  const low = (key) => path.reduce((m, p) => (p[key] < m.amount ? { date: p.date, amount: p[key] } : m), { date: today, amount: Infinity });
  const lowWithout = low('balanceWithout');
  const lowWith = low('balanceWith');
  const status = lowWithout.amount < 0 ? 'bounce' : lowWithout.amount < buffer ? 'tight' : 'ok';
  const shortfall = Math.max(0, buffer - lowWithout.amount);
  const move = Math.min(shortfall, Math.max(0, savingsBalance));

  return {
    today,
    endDate: end,
    startBalance: checkingBalance,
    buffer,
    status,
    lowWithoutIncome: lowWithout,
    lowWithIncome: lowWith,
    fix: shortfall > 0 ? { moveFromSavings: move, before: lowWithout.date, stillShort: shortfall - move } : null,
    path,
    cardItems,
    cardTotal: cardItems.reduce((s, e) => s + e.amount, 0),
    warnings,
  };
}

/**
 * How much of a card balance can be paid from Checking now without breaking the buffer.
 * `onTime` is a forecast with income arriving as expected; `late` is the same with income delayed
 * (a late paycheck). safeNow is what survives the late case, so a delayed paycheck is not a bounce;
 * safeTotal is what fits if income arrives on time, so the remainder can follow payday.
 */
export function payoffAdvice(onTime, late, cardOwed) {
  const room = (fc) => Math.max(0, Math.min(...fc.path.map((p) => p.balanceWith)) - fc.buffer);
  const cap = (n) => Math.min(n, cardOwed);
  const round = (n) => Math.floor(n / 5000) * 5000; // down to $50
  const safeNow = round(cap(room(late)));
  const safeTotal = Math.max(safeNow, round(cap(room(onTime))));
  return {
    cardOwed,
    safeNow,
    safeTotal,
    afterIncome: safeTotal - safeNow,
    horizonDays: onTime.path.length - 1,
    buffer: onTime.buffer,
  };
}
