import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCategories } from '../src/actual.js';

const q = () => {
  const chain = { filter: () => chain, select: () => chain };
  return chain;
};

test('maps budget month and weekly spend, skipping income', async () => {
  const client = {
    q,
    getBudgetMonth: async () => ({
      categoryGroups: [
        { name: 'Income', is_income: true, categories: [{ id: 'i', name: 'Pay', balance: 0 }] },
        { name: 'Food', categories: [{ id: 'g', name: 'Groceries', balance: 9000 }] },
      ],
    }),
    runQuery: async () => ({
      data: [
        { category: 'g', amount: -2500 },
        { category: 'g', amount: 500 }, // refund
      ],
    }),
  };
  const cats = await readCategories(client, '2026-11-24');
  assert.deepEqual(cats, [{ id: 'g', name: 'Groceries', group: 'Food', balance: 9000, spentThisWeek: 2000 }]);
});
