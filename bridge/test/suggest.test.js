import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payeeKey, payeeTokens, suggestCategory } from '../src/suggest.js';

test('store numbers, locations markers and processor prefixes are ignored', () => {
  assert.equal(payeeKey('SPROUTS FARMERS MKT #123 SAN DIEGO'), 'sprouts farmers');
  assert.equal(payeeKey('TST* Blue Bottle 4455'), 'blue bottle');
  assert.equal(payeeKey('SQ *CORNER CAFE'), 'corner cafe');
  assert.deepEqual(payeeTokens(''), []);
});

test('most common category wins with counts', () => {
  const history = [
    ...Array(3).fill({ payee: 'Sprouts #1', categoryId: 'groc' }),
    { payee: 'Sprouts #9', categoryId: 'shop' },
    { payee: 'Other', categoryId: 'x' },
  ];
  assert.deepEqual(suggestCategory('SPROUTS 22', history), { categoryId: 'groc', count: 3, total: 4, match: 'exact' });
});

test('falls back to the first word when the full key differs', () => {
  const history = [{ payee: 'Target T-1234', categoryId: 'shop' }];
  const s = suggestCategory('TARGET.COM', history);
  assert.equal(s.categoryId, 'shop');
});

test('no history or empty payee gives no suggestion', () => {
  assert.equal(suggestCategory('Zzz', []), null);
  assert.equal(suggestCategory('', [{ payee: 'a b', categoryId: 'c' }]), null);
});
