import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const fake = { clientVersion: () => '0.0.0', summary: async () => ({ accounts: 2 }) };
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
