import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverySummary } from '../src/recovery.js';

const m = (month, surplus, ...balances) => ({ month, surplus, cats: balances.map((b, i) => ({ id: `c${i}`, name: `c${i}`, balance: b })) });

test('reports running overspend, applied money and what is left to recover', () => {
  const r = recoverySummary({
    months: [m('2026-08', 5000, -3000, 500), m('2026-09', 2000, -4000, -1000), m('2026-10', 900, -4500)],
    used: { '2026-08': 3000 },
  });
  assert.deepEqual(r.months.map((x) => x.overspent), [3000, 5000, 4500]);
  assert.equal(r.totalExtra, 7000); // the current month's extra is not counted yet
  assert.equal(r.applied, 3000);
  assert.equal(r.poolRemaining, 4000);
  assert.equal(r.overspentNow, 4500);
  assert.equal(r.leftToRecover, 500);
  assert.equal(r.months[2].complete, false);
});

test('never negative: a bigger pool than the overspend leaves nothing to recover', () => {
  const r = recoverySummary({ months: [m('2026-08', 9000, -1000), m('2026-09', 0, -1000)] });
  assert.equal(r.leftToRecover, 0);
  assert.equal(r.poolRemaining, 9000);
});

test('a month with a shortfall reduces the pool; empty input is safe', () => {
  assert.equal(recoverySummary({ months: [m('2026-08', -2000, 0), m('2026-09', 0, 0)] }).poolRemaining, 0);
  assert.equal(recoverySummary({ months: [] }).leftToRecover, 0);
});
