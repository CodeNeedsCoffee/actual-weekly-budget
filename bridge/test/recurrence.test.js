import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences } from '../src/recurrence.js';

test('one-time date', () => {
  assert.deepEqual(occurrences('2026-12-05', '2026-11-24', '2026-12-08').dates, ['2026-12-05']);
  assert.deepEqual(occurrences('2027-02-19', '2026-11-24', '2026-12-08').dates, []);
});

test('monthly on the 1st with weekend shift before', () => {
  const cfg = { start: '2026-06-01', frequency: 'monthly', patterns: [], skipWeekend: true, weekendSolveMode: 'before', endMode: 'never' };
  // 2026-08-01 is a Saturday -> Friday 07-31; 2026-11-01 is a Sunday -> Friday 10-30
  assert.deepEqual(occurrences(cfg, '2026-07-30', '2026-08-02').dates, ['2026-07-31']);
  assert.deepEqual(occurrences(cfg, '2026-10-29', '2026-11-02').dates, ['2026-10-30']);
  assert.deepEqual(occurrences(cfg, '2026-11-24', '2026-12-08').dates, ['2026-12-01']);
});

test('weekly interval and occurrence cap', () => {
  const cfg = { start: '2026-11-27', frequency: 'weekly', interval: 3, patterns: [], endMode: 'after_n_occurrences', endOccurrences: 4 };
  assert.deepEqual(occurrences(cfg, '2026-11-24', '2027-02-28').dates, ['2026-11-27', '2026-12-18', '2027-01-08', '2027-01-29']);
});

test('monthly day clamps to month length and handles last-day patterns', () => {
  const cfg = { start: '2026-01-31', frequency: 'monthly', patterns: [], endMode: 'never' };
  assert.deepEqual(occurrences(cfg, '2026-02-01', '2026-02-28').dates, ['2026-02-28']);
  const last = { start: '2026-01-31', frequency: 'monthly', patterns: [{ value: 'last', type: 'day' }, { value: 15, type: 'day' }], endMode: 'never' };
  assert.deepEqual(occurrences(last, '2026-04-01', '2026-04-30').dates, ['2026-04-15', '2026-04-30']);
});

test('end on date stops the series; unsupported patterns are flagged, not guessed', () => {
  const cfg = { start: '2026-11-01', frequency: 'daily', endMode: 'on_date', endDate: '2026-11-03' };
  assert.deepEqual(occurrences(cfg, '2026-11-01', '2026-11-30').dates, ['2026-11-01', '2026-11-02', '2026-11-03']);
  const weird = { start: '2026-11-01', frequency: 'monthly', patterns: [{ value: 'MO', type: 'MO' }], endMode: 'never' };
  assert.equal(occurrences(weird, '2026-11-01', '2026-11-30').unsupported, true);
});
