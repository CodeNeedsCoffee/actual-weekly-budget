import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const fake = {
  clientVersion: () => '0.0.0',
  summary: async () => ({ accounts: 2 }),
  today: () => '2026-11-24',
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
