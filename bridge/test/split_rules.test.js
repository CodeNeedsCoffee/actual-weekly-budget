import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSuggestionFor } from '../src/split_rules.js';

const cats = [
  { id: 'g', name: 'Groceries', isIncome: false },
  { id: 'h', name: 'Household', isIncome: false },
];
const rules = [{ match: 'Store', parts: [{ category: 'Groceries', percent: 50 }, { category: 'Household' }] }];

test('matches the payee and resolves category ids', () => {
  const s = splitSuggestionFor('STORE #1234 CITY', rules, cats);
  assert.deepEqual(s.parts, [{ categoryId: 'g', percent: 50 }, { categoryId: 'h' }]);
  assert.equal(s.label, 'Split 50% Groceries + Household');
});

test('matches a word anywhere in the payee, such as after a wallet prefix', () => {
  assert.ok(splitSuggestionFor('APLPAY STORE IRVINE CA', rules, cats));
  assert.equal(splitSuggestionFor('Storefront', rules, cats), null); // whole words only
});

test('no match or unknown category gives null', () => {
  assert.equal(splitSuggestionFor('Other', rules, cats), null);
  assert.equal(splitSuggestionFor('Store', [{ match: 'store', parts: [{ category: 'Nope', percent: 50 }, { category: 'Household' }] }], cats), null);
  assert.equal(splitSuggestionFor('', rules, cats), null);
});
