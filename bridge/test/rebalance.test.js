import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRebalance } from '../src/rebalance.js';

const c = (id, balance, extra = {}) => ({ id, name: id, budgeted: 10000, balance, carryover: false, ...extra });
const one = (cats, opts) => planRebalance({ months: [{ month: '2026-10', cats }], ...opts });

test('moves from the biggest spare balance to the overspent category, never beyond the deficit', () => {
  const p = one([c('over', -3000), c('big', 8000), c('small', 1000)]);
  assert.deepEqual(p.moves.map((m) => [m.from, m.to, m.amount]), [['big', 'over', 3000]]);
  assert.equal(p.cells.find((x) => x.categoryId === 'big').to, 7000);
  assert.equal(p.cells.find((x) => x.categoryId === 'over').to, 13000);
  assert.equal(p.overspentAfter[0].amount, 0);
});

test('splits across donors when one is not enough', () => {
  const p = one([c('over', -9000), c('a', 6000), c('b', 4000)]);
  assert.deepEqual(p.moves.map((m) => [m.from, m.amount]), [['a', 6000], ['b', 3000]]);
});

test('cannot take more than a donor has budgeted (no negative budgets)', () => {
  const p = one([c('over', -5000), c('d', 9000, { budgeted: 2000 })]);
  assert.equal(p.moves[0].amount, 2000);
  assert.equal(p.overspentAfter[0].amount, -3000);
});

test('protected categories and overspent ones are never donors', () => {
  const p = one([c('over', -3000), c('rent', 9000, { protected: true }), c('also', -500)]);
  assert.equal(p.moves.length, 0);
});

test('Savings is only used when allowed, and only after other donors', () => {
  const cats = [c('over', -5000), c('sav', 9000, { isSavings: true, budgeted: 0 }), c('other', 2000)];
  assert.deepEqual(one(cats).moves.map((m) => [m.from, m.amount]), [['other', 2000]]);
  const withSav = one(cats, { includeSavings: true });
  assert.deepEqual(withSav.moves.map((m) => [m.from, m.amount]), [['other', 2000], ['sav', 3000]]);
  assert.equal(withSav.cells.find((x) => x.categoryId === 'sav').to, -3000); // Savings may go below zero
  assert.equal(withSav.overspentAfter[0].amount, 0);
});

test('a carried-over donor is limited so it does not go overspent in later months', () => {
  const months = [
    { month: '2026-09', cats: [c('over', -1000), c('d', 5000, { carryover: true })] },
    { month: '2026-10', cats: [c('over', 0), c('d', 1500)] }, // d only has 1500 left in Oct (carry included)
  ];
  const p = planRebalance({ months });
  assert.equal(p.moves[0].amount, 1000); // within 1500
  const need = planRebalance({ months: [{ ...months[0], cats: [c('over', -4000), c('d', 5000, { carryover: true })] }, months[1]] });
  assert.equal(need.moves[0].amount, 1500); // capped by Oct balance, not Sep's 5000
});

test('money moved in one month carries into later months for the recipient', () => {
  const months = [
    { month: '2026-09', cats: [c('over', -2000, { carryover: true }), c('d', 5000)] },
    { month: '2026-10', cats: [c('over', -2000), c('d', 5000)] }, // Oct balance already includes Sep's -2000
  ];
  const p = planRebalance({ months });
  assert.equal(p.moves.filter((m) => m.month === '2026-09').length, 1);
  assert.equal(p.moves.filter((m) => m.month === '2026-10').length, 0); // Sep's move cleared Oct's carried deficit
  assert.equal(p.overspentAfter[1].amount, 0);
});
