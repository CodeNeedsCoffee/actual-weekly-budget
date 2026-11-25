import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast, payoffAdvice, worstCase } from '../src/forecast.js';

const monthly = (start) => ({ start, frequency: 'monthly', patterns: [], endMode: 'never' });

test('worst case: approx widens outflows, between takes the larger bill', () => {
  assert.equal(worstCase(-10000, 'isapprox'), -10750);
  assert.equal(worstCase(10000, 'isapprox'), 9250);
  assert.equal(worstCase({ num1: -1500, num2: -5400 }, 'isbetween'), -5400);
  assert.equal(worstCase(-2500, 'is'), -2500);
});

const base = {
  today: '2026-11-24',
  days: 14,
  checkingBalance: 800000,
  savingsBalance: 200000,
  checkingId: 'chk',
  buffer: 100000,
};

test('bills on checking reduce the balance; card schedules are reported separately', () => {
  const fc = forecast({
    ...base,
    schedules: [
      { id: 's1', name: 'Rent', accountId: 'chk', amount: -330000, op: 'is', dateCfg: monthly('2026-12-01'), nextDate: '2026-12-01' },
      { id: 's2', name: 'Streaming', accountId: 'card', amount: -1400, op: 'is', dateCfg: monthly('2026-12-08'), nextDate: '2026-12-08' },
    ],
  });
  assert.equal(fc.path.at(-1).balanceWithout, 800000 - 330000);
  assert.equal(fc.cardTotal, -1400);
  assert.equal(fc.cardItems.length, 1);
  assert.equal(fc.status, 'ok');
});

test('income is excluded from the without-income line, and a bounce is flagged with a savings fix', () => {
  const fc = forecast({
    ...base,
    checkingBalance: 400000,
    schedules: [
      { id: 's1', name: 'Rent', accountId: 'chk', amount: -330000, op: 'is', dateCfg: monthly('2026-12-01'), nextDate: '2026-12-01' },
      { id: 's2', name: 'Car', accountId: 'chk', amount: -90000, op: 'is', dateCfg: monthly('2026-12-06'), nextDate: '2026-12-06' },
    ],
    adjustments: { items: [{ name: 'Payroll', amount: 360000, dayOfMonth: [28] }] },
  });
  assert.equal(fc.status, 'bounce');
  assert.equal(fc.lowWithoutIncome.amount, 400000 - 330000 - 90000);
  assert.ok(fc.lowWithIncome.amount > fc.lowWithoutIncome.amount);
  assert.equal(fc.fix.moveFromSavings, 100000 + 20000);
  assert.equal(fc.fix.before, '2026-12-06');
  assert.equal(fc.fix.stillShort, 0);
});

test('an overdue schedule lands on today and already-posted occurrences are skipped', () => {
  const fc = forecast({
    ...base,
    schedules: [{ id: 's', name: 'Weekly', accountId: 'chk', amount: -5000, op: 'is', dateCfg: { start: '2026-11-17', frequency: 'weekly', interval: 1, patterns: [], endMode: 'never' }, nextDate: '2026-11-24' }],
  });
  assert.equal(fc.path[0].items.length, 1); // today
  assert.equal(fc.path.filter((p) => p.items.length).length, 3); // 11-24, 12-01, 12-08
});

test('variable daily spending and unsupported patterns', () => {
  const fc = forecast({
    ...base,
    days: 2,
    schedules: [{ id: 'w', name: 'Odd', accountId: 'chk', amount: -100, op: 'is', dateCfg: { start: '2026-11-01', frequency: 'monthly', patterns: [{ value: 'MO', type: 'MO' }], endMode: 'never' }, nextDate: '2026-12-01' }],
    adjustments: { variablePerDay: 5000 },
  });
  assert.equal(fc.path.at(-1).balanceWithout, 800000 - 2 * 5000);
  assert.equal(fc.warnings.length, 1);
});

test('expected mode uses stated amounts and range midpoints', () => {
  assert.equal(worstCase(-10000, 'isapprox', 'expected'), -10000);
  assert.equal(worstCase({ num1: -1500, num2: -5500 }, 'isbetween', 'expected'), -3500);
});

test('payoff advice: safeNow survives a late paycheck, safeTotal assumes it arrives', () => {
  const input = {
    ...base,
    schedules: [{ id: 's1', name: 'Rent', accountId: 'chk', amount: -330000, op: 'is', dateCfg: monthly('2026-12-01'), nextDate: '2026-12-01' }],
    adjustments: { items: [{ name: 'Payroll', amount: 360000, dayOfMonth: [28] }] },
    amountMode: 'expected',
  };
  const onTime = forecast(input);
  const late = forecast({ ...input, incomeDelayDays: 7 });
  const a = payoffAdvice(onTime, late, 5000000);
  // late payroll lands 12-05, after rent on 12-01: low = 800000 - 330000 = 470000 -> room 370000
  assert.equal(a.safeNow, 370000);
  assert.ok(a.safeTotal >= a.safeNow);
  assert.equal(a.afterIncome, a.safeTotal - a.safeNow);
  assert.equal(payoffAdvice(onTime, late, 20000).safeNow, 20000); // capped at what is owed
  assert.equal(payoffAdvice(onTime, late, 5000000).horizonDays, 14);
});
