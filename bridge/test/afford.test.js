import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affordCheck } from '../src/afford.js';

const pos = { remainingThisWeek: 5000, monthRemaining: 12000 };

test('yes when it fits this week', () => {
  assert.equal(affordCheck({ amount: 4000, position: pos }).verdict, 'yes');
});
test('tight when over the week but inside the month', () => {
  const r = affordCheck({ amount: 8000, position: pos });
  assert.equal(r.verdict, 'tight');
  assert.equal(r.remainingThisWeekAfter, -3000);
});
test('no when over the month balance', () => {
  const r = affordCheck({ amount: 13000, position: pos });
  assert.equal(r.verdict, 'no');
  assert.equal(r.monthRemainingAfter, -1000);
});
test('overspent category is always no', () => {
  assert.equal(
    affordCheck({ amount: 100, position: { remainingThisWeek: 0, monthRemaining: -500 } }).verdict,
    'no',
  );
});
