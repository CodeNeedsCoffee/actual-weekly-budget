import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitActions } from '../src/splits.js';

test('even split uses a percent for the first part and the remainder for the last', () => {
  const a = splitActions([{ categoryId: 'g', percent: 50 }, { categoryId: 'h' }]);
  assert.deepEqual(a[0], { op: 'set-split-amount', value: 50, options: { method: 'fixed-percent', splitIndex: 1 } });
  assert.deepEqual(a[1], { op: 'set', field: 'category', value: 'g', options: { splitIndex: 1 } });
  assert.equal(a[2].options.method, 'remainder');
  assert.equal(a[3].value, 'h');
});

test('percents that do not add up or two open parts are rejected', () => {
  assert.throws(() => splitActions([{ categoryId: 'a', percent: 60 }, { categoryId: 'b', percent: 30 }]));
  assert.throws(() => splitActions([{ categoryId: 'a' }, { categoryId: 'b' }]));
  assert.throws(() => splitActions([{ categoryId: 'a' }]));
});
