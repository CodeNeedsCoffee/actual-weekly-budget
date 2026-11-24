import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekBounds, monthBounds, weeklyPosition } from '../src/weekly.js';

test('weeks start on Sunday', () => {
  assert.deepEqual(weekBounds('2026-11-23'), { start: '2026-11-22', end: '2026-11-28' }); // a Monday
  assert.deepEqual(weekBounds('2026-11-22'), { start: '2026-11-22', end: '2026-11-28' }); // the Sunday
  assert.deepEqual(weekBounds('2026-11-28'), { start: '2026-11-22', end: '2026-11-28' }); // the Saturday
});

test('month bounds', () => {
  assert.deepEqual(monthBounds('2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
});

test('allowance spreads the start-of-week balance over the days left in the month', () => {
  // Nov 22 (Sun) to Nov 30: 9 days left, 7 in this week. 9000 cents available at week start.
  const p = weeklyPosition({ today: '2026-11-24', balance: 8000, spentThisWeek: 1000 });
  assert.equal(p.allowance, 7000);
  assert.equal(p.remainingThisWeek, 6000);
  assert.equal(p.monthRemaining, 8000);
});

test('week crossing a month boundary only counts the days inside the month', () => {
  // Nov 29 (Sun) to Nov 30: both days are this week's days in the month.
  const p = weeklyPosition({ today: '2026-11-29', balance: 5000, spentThisWeek: 0 });
  assert.equal(p.allowance, 5000);
});

test('overspent category has no allowance and reports the deficit', () => {
  const p = weeklyPosition({ today: '2026-11-24', balance: -2500, spentThisWeek: 300 });
  assert.equal(p.allowance, 0);
  assert.equal(p.overspent, 2500);
  assert.equal(p.remainingThisWeek, -300);
});
