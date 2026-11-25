import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const fake = {
  clientVersion: () => '0.0.0',
  summary: async () => ({ accounts: 2 }),
  today: () => '2026-11-24',
  listCategories: async () => [
    { id: 'c1', name: 'Groceries', group: 'Food', isIncome: false },
    { id: 'c2', name: 'Shopping', group: 'Misc', isIncome: false },
  ],
  uncategorized: async () => [
    { id: 't1', date: '2026-11-20', amount: -4200, payee: 'SPROUTS #55', account: 'Checking', notes: '' },
    { id: 't2', date: '2026-11-19', amount: -900, payee: 'Unknown Shop', account: 'Checking', notes: '' },
  ],
  history: async () => [
    { payee: 'Sprouts #1', categoryId: 'c1' },
    { payee: 'Sprouts #2', categoryId: 'c1' },
  ],
  splitTransaction: async (id, parts) => (id === 'gone' ? { error: 'not found' } : id === 'done' ? { error: 'already split' } : (fake.split = [id, parts], { ok: true })),
  setCategory: async (id, categoryId) => { fake.last = [id, categoryId]; },
  categories: async () => [{ id: 'c1', name: 'Groceries', group: 'Food', balance: 8000, spentThisWeek: 1000 }],
};
const app = () => buildApp({ token: 'tok1', actual: fake });

test('health is open and reports client version', async () => {
  const res = await app().inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, apiClientVersion: '0.0.0' });
});

test('protected routes reject missing or wrong token', async () => {
  const a = app();
  assert.equal((await a.inject({ method: 'GET', url: '/summary' })).statusCode, 401);
  const bad = await a.inject({ method: 'GET', url: '/summary', headers: { authorization: 'Bearer nope' } });
  assert.equal(bad.statusCode, 401);
});

test('protected routes accept the right token', async () => {
  const res = await app().inject({ method: 'GET', url: '/summary', headers: { authorization: 'Bearer tok1' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { accounts: 2 });
});

const auth = { authorization: 'Bearer tok1' };

test('weekly returns a position per category', async () => {
  const res = await app().inject({ method: 'GET', url: '/weekly?date=2026-11-24', headers: auth });
  assert.equal(res.statusCode, 200);
  const c = res.json().categories[0];
  assert.equal(c.name, 'Groceries');
  assert.equal(c.allowance, 7000);
  assert.equal(c.remainingThisWeek, 6000);
});

test('weekly rejects a bad date', async () => {
  const res = await app().inject({ method: 'GET', url: '/weekly?date=tomorrow', headers: auth });
  assert.equal(res.statusCode, 400);
});

test('afford answers yes/tight/no and validates input', async () => {
  const a = app();
  const post = (body) => a.inject({ method: 'POST', url: '/afford', headers: auth, payload: body });
  assert.equal((await post({ amount: 2000, categoryId: 'c1' })).json().verdict, 'yes');
  assert.equal((await post({ amount: 7000, categoryId: 'c1' })).json().verdict, 'tight');
  assert.equal((await post({ amount: 9000, categoryId: 'c1' })).json().verdict, 'no');
  assert.equal((await post({ amount: 1.5, categoryId: 'c1' })).statusCode, 400);
  assert.equal((await post({ amount: 100, categoryId: 'zzz' })).statusCode, 404);
});

test('uncategorized inbox suggests from history with a reason, and null when unknown', async () => {
  const res = await app().inject({ method: 'GET', url: '/transactions/uncategorized', headers: auth });
  const [a, b] = res.json().transactions;
  assert.equal(a.suggestion.categoryName, 'Groceries');
  assert.match(a.suggestion.reason, /2 of 2 past "SPROUTS #55" charges were Groceries/);
  assert.equal(b.suggestion, null);
});

test('categorizing validates the category and writes it', async () => {
  const a = app();
  const post = (body) => a.inject({ method: 'POST', url: '/transactions/t1/category', headers: auth, payload: body });
  assert.equal((await post({ categoryId: 'nope' })).statusCode, 400);
  assert.equal((await post({ categoryId: 'c2' })).statusCode, 200);
  assert.deepEqual(fake.last, ['t1', 'c2']);
});

test('split validates parts and maps adapter errors', async () => {
  const a = app();
  const post = (id, body) => a.inject({ method: 'POST', url: `/transactions/${id}/split`, headers: auth, payload: body });
  const ok = { parts: [{ categoryId: 'c1', percent: 50 }, { categoryId: 'c2' }] };
  assert.equal((await post('t1', ok)).statusCode, 200);
  assert.equal(fake.split[0], 't1');
  assert.equal((await post('t1', { parts: [{ categoryId: 'c1' }] })).statusCode, 400);
  assert.equal((await post('t1', { parts: [{ categoryId: 'zz', percent: 50 }, { categoryId: 'c2' }] })).statusCode, 400);
  assert.equal((await post('gone', ok)).statusCode, 404);
  assert.equal((await post('done', ok)).statusCode, 409);
});

test('inbox offers a split suggestion when a split rule matches', async () => {
  const withRules = buildApp({
    token: 'tok1',
    actual: fake,
    splitRules: [{ match: 'unknown', parts: [{ category: 'Groceries', percent: 50 }, { category: 'Shopping' }] }],
  });
  const res = await withRules.inject({ method: 'GET', url: '/transactions/uncategorized', headers: auth });
  const [a, b] = res.json().transactions;
  assert.equal(a.splitSuggestion, null);
  assert.deepEqual(b.splitSuggestion.parts, [{ categoryId: 'c1', percent: 50 }, { categoryId: 'c2' }]);
});
