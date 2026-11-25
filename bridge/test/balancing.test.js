import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planExtraIncome, planId } from '../src/balancing.js';
import { createLog } from '../src/balancing_log.js';

const cat = (id, balance, extra = {}) => ({ id, name: id, budgeted: 10000, balance, carryover: true, ...extra });

test('surplus covers the biggest deficits first and never more than the deficit', () => {
  const p = planExtraIncome({
    months: [{ month: '2026-08', surplus: 5000, cats: [cat('a', -1000), cat('b', -6000), cat('c', 4000)] }],
  });
  assert.deepEqual(p.months[0].moves.map((m) => [m.categoryId, m.add]), [['b', 5000]]);
  assert.equal(p.cells[0].to, 15000);
  assert.equal(p.months[0].overspentAfter, -2000); // a (-1000) and b (-1000) remain
});

test('a shortfall month nets against earlier surplus; nothing is spent while the pool is negative', () => {
  const p = planExtraIncome({
    months: [
      { month: '2026-08', surplus: 3000, cats: [cat('a', 0)] },
      { month: '2026-09', surplus: -5000, cats: [cat('a', -4000)] },
      { month: '2026-10', surplus: 4000, cats: [cat('a', -4000)] },
    ],
  });
  assert.equal(p.cells.length, 1); // Aug has no deficit, Sep pool is -2000, Oct pool +2000
  assert.equal(p.months[1].allocated, 0);
  assert.equal(p.months[2].allocated, 2000);
});

test('money added in one month carries into later months only where carryover is on', () => {
  const months = (carryover) => [
    { month: '2026-08', surplus: 3000, cats: [cat('a', -3000, { carryover })] },
    { month: '2026-09', surplus: 0, cats: [cat('a', -3000, { carryover })] },
  ];
  assert.equal(planExtraIncome({ months: months(true) }).months[1].overspentAfter, 0);
  assert.equal(planExtraIncome({ months: months(false) }).months[1].overspentAfter, -3000);
});

test('income already used is not spent again', () => {
  const m = [{ month: '2026-08', surplus: 5000, cats: [cat('a', -9000)] }];
  assert.equal(planExtraIncome({ months: m }).months[0].allocated, 5000);
  assert.equal(planExtraIncome({ months: m, used: { '2026-08': 5000 } }).months[0].allocated, 0);
  assert.equal(planExtraIncome({ months: m, used: { '2026-08': 2000 } }).months[0].allocated, 3000);
});

test('plan ids change when cells change', () => {
  const a = [{ month: 'm', categoryId: 'a', from: 1, to: 2 }];
  assert.equal(planId(a), planId([...a]));
  assert.notEqual(planId(a), planId([{ ...a[0], to: 3 }]));
});

test('log sums used per month and supports removal', () => {
  const log = createLog(join(mkdtempSync(join(tmpdir(), 'bal-')), 'log.json'));
  log.add({ id: 'x', at: 't', used: { '2026-08': 100 }, cells: [] });
  log.add({ id: 'y', at: 't', used: { '2026-08': 50, '2026-09': 7 }, cells: [] });
  assert.deepEqual(log.used(), { '2026-08': 150, '2026-09': 7 });
  assert.equal(log.remove('x').id, 'x');
  assert.deepEqual(log.used(), { '2026-08': 50, '2026-09': 7 });
  assert.equal(log.remove('nope'), null);
});
