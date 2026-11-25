import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSweep } from '../src/sweep.js';

const c = (id, balance, extra = {}) => ({ id, name: id, budgeted: 10000, balance, carryover: false, ...extra });
const month = (cats) => [{ month: '2026-10', cats }];
const sav = c('sav', 0, { isSavings: true, budgeted: 0 });

test('sweeps spare money largest first and credits Savings', () => {
  const p = planSweep({ months: month([sav, c('a', 6000), c('b', 2000)]) });
  assert.equal(p.free, 8000);
  assert.deepEqual(p.takes.map((t) => [t.name, t.amount]), [['a', 6000], ['b', 2000]]);
  assert.deepEqual(p.cells.find((x) => x.categoryId === 'sav'), { month: '2026-10', categoryId: 'sav', name: 'sav', from: 0, to: 8000 });
  assert.equal(p.cells.find((x) => x.categoryId === 'a').to, 4000);
});

test('an explicit amount is capped at the free money; keep leaves a cushion', () => {
  const m = month([sav, c('a', 5000)]);
  assert.equal(planSweep({ months: m, amount: 99999 }).total, 5000);
  assert.equal(planSweep({ months: m, amount: 1200 }).total, 1200);
  assert.equal(planSweep({ months: m, keep: 2000 }).total, 3000);
});

test('money an overspent category needs is not swept', () => {
  const p = planSweep({ months: month([sav, c('over', -3000), c('a', 5000)]) });
  assert.equal(p.free, 2000); // 5000 spare minus the 3000 deficit
  assert.equal(p.total, 2000);
  assert.equal(p.stillOverspent, 0);
});

test('nothing is free when deficits use it all; protected categories are left alone', () => {
  const none = planSweep({ months: month([sav, c('over', -9000), c('a', 5000)]) });
  assert.equal(none.total, 0);
  assert.equal(none.cells.length, 0);
  assert.equal(none.stillOverspent, -4000);
  const prot = planSweep({ months: month([sav, c('rent', 5000, { protected: true })]) });
  assert.equal(prot.total, 0);
});

test('a donor cannot go below a zero budget and Savings is never a donor', () => {
  const p = planSweep({ months: month([c('sav', 9000, { isSavings: true, budgeted: 0 }), c('a', 9000, { budgeted: 1500 })]) });
  assert.equal(p.total, 1500);
  assert.ok(p.takes.every((t) => t.categoryId !== 'sav'));
});

test('no savings category reports an error', () => {
  assert.equal(planSweep({ months: month([c('a', 100)]) }).error, 'savings category not found');
});
