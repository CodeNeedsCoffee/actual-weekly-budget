import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createLog } from '../src/balancing_log.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  syncStatus: async () => [{ id: 'a1', name: 'Checking', lastSync: '2026-11-24T00:00:00.000Z', hoursAgo: 3, latestTransaction: '2026-11-23', stale: false }],
  runSync: async (accountId) => (accountId === 'bad' ? { ok: false, error: 'bank unreachable' } : { ok: true }),
  forecastInputs: async () => ({
    accounts: [
      { id: 'chk', name: '360 Checking', balance: 800000 },
      { id: 'sav', name: 'Performance Savings', balance: 200000 },
      { id: 'card', name: 'Big Card', balance: -500000 },
    ],
    schedules: [
      { id: 's1', name: 'Rent', accountId: 'chk', amount: -330000, op: 'is', dateCfg: { start: '2026-12-01', frequency: 'monthly', patterns: [], endMode: 'never' }, nextDate: '2026-12-01', completed: false },
    ],
  }),
  balancingMonths: async () => [
    { month: '2026-08', surplus: 5000, cats: [{ id: 'c1', name: 'Groceries', budgeted: 10000, balance: -3000, carryover: true }, { id: 'c2', name: 'Shopping', budgeted: 5000, balance: -9000, carryover: true }] },
  ],
  setBudget: async (month, id, cents) => { (fake.budgetWrites ??= []).push([month, id, cents]); },
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

test('sync status and a sync run return per-account freshness', async () => {
  const a = app();
  const status = await a.inject({ method: 'GET', url: '/sync/status', headers: auth });
  assert.equal(status.json().accounts[0].stale, false);
  const run = await a.inject({ method: 'POST', url: '/sync', headers: auth, payload: {} });
  assert.equal(run.json().ok, true);
  assert.equal(run.json().accounts.length, 1);
  const bad = await a.inject({ method: 'POST', url: '/sync', headers: auth, payload: { accountId: 'bad' } });
  assert.equal(bad.json().ok, false);
  assert.match(bad.json().error, /unreachable/);
});

test('forecast and payoff endpoints use the configured account names', async () => {
  const a = buildApp({ token: 'tok1', actual: fake, forecastConfig: { payoffCard: 'big card', buffer: 100000 } });
  const f = await a.inject({ method: 'GET', url: '/forecast', headers: auth });
  assert.equal(f.statusCode, 200);
  assert.equal(f.json().startBalance, 800000);
  assert.equal(f.json().path.length, 15);
  assert.equal(f.json().lowWithoutIncome.amount, 470000);
  const p = await a.inject({ method: 'GET', url: '/payoff', headers: auth });
  assert.equal(p.json().cardOwed, 500000);
  assert.equal(p.json().safeNow, 370000);
  assert.equal(p.json().incomeLateDays, 7);
  const noCard = await app().inject({ method: 'GET', url: '/payoff', headers: auth });
  assert.equal(noCard.statusCode, 422);
});

test('balancing: preview, apply once, replay is empty, revert restores', async () => {
  const log = createLog(join(mkdtempSync(join(tmpdir(), 'app-')), 'log.json'));
  const a = buildApp({ token: 'tok1', actual: fake, balancingLog: log, forecastConfig: { balancingFrom: '2026-08' } });
  const get = (url) => a.inject({ method: 'GET', url, headers: auth });
  const post = (url, payload) => a.inject({ method: 'POST', url, headers: auth, payload });

  const prev = (await get('/balancing/proposal?from=2026-08&to=2026-08')).json();
  assert.equal(prev.totalAllocated, 5000);
  assert.deepEqual(prev.months[0].moves.map((m) => [m.categoryId, m.add]), [['c2', 5000]]);

  assert.equal((await post('/balancing/apply', { from: '2026-08', to: '2026-08', id: 'stale' })).statusCode, 409);
  const done = await post('/balancing/apply', { from: '2026-08', to: '2026-08', id: prev.id });
  assert.equal(done.json().applied, 1);
  assert.deepEqual(fake.budgetWrites.at(-1), ['2026-08', 'c2', 10000]);

  // The fake budget does not change, but the log now marks the extra income as spent.
  const again = (await get('/balancing/proposal?from=2026-08&to=2026-08')).json();
  assert.equal(again.totalAllocated, 0);

  // Revert: current budget (fake) still shows the old amount, so the cell reads as changed -> conflict, kept.
  const rev = await post('/balancing/revert', { id: done.json().logId });
  assert.equal(rev.json().ok, false);
  assert.equal(rev.json().conflicts.length, 1);
  assert.equal((await post('/balancing/revert', { id: 'nope' })).statusCode, 404);

  assert.equal((await post('/balancing/record', { month: '2026-08', amount: 100 })).statusCode, 200);
  assert.equal((await post('/balancing/record', { month: 'x', amount: 100 })).statusCode, 400);
  assert.equal((await get('/balancing/proposal')).statusCode, 200); // uses balancingFrom
});

test('balancing is off without a log', async () => {
  const res = await app().inject({ method: 'GET', url: '/balancing/proposal?from=2026-08&to=2026-08', headers: auth });
  assert.equal(res.statusCode, 501);
});

test('rebalance: preview, stale id refused, apply logs a reversible entry', async () => {
  const log = createLog(join(mkdtempSync(join(tmpdir(), 'rb-')), 'log.json'));
  const fakeRb = {
    ...fake,
    today: () => '2026-11-24',
    balancingMonths: async () => [
      { month: '2026-10', surplus: 0, cats: [
        { id: 'c1', name: 'Groceries', budgeted: 10000, balance: -3000, carryover: false },
        { id: 'c2', name: 'Spare', budgeted: 10000, balance: 8000, carryover: false },
        { id: 'c3', name: 'Rent', budgeted: 10000, balance: 9000, carryover: false },
        { id: 'c4', name: 'Savings', budgeted: 0, balance: 5000, carryover: false },
      ] },
    ],
  };
  const a = buildApp({ token: 'tok1', actual: fakeRb, balancingLog: log, forecastConfig: { protect: ['rent'] } });
  const get = (url) => a.inject({ method: 'GET', url, headers: auth });
  const post = (url, payload) => a.inject({ method: 'POST', url, headers: auth, payload });

  const prev = (await get('/rebalance/proposal')).json(); // defaults to the month that just ended
  assert.equal(prev.from, '2026-10');
  assert.deepEqual(prev.moves.map((m) => [m.from, m.to, m.amount]), [['Spare', 'Groceries', 3000]]);

  assert.equal((await post('/rebalance/apply', { id: 'stale' })).statusCode, 409);
  const done = await post('/rebalance/apply', { id: prev.id });
  assert.equal(done.json().applied, 2);
  assert.deepEqual(fake.budgetWrites.slice(-2).map((w) => w[2]).sort((x, y) => x - y), [7000, 13000]);
  assert.equal((await get('/balancing/log')).json().entries[0].moved, 3000);
  assert.equal((await get('/rebalance/proposal?from=bad')).statusCode, 400);

  const withSav = (await get('/rebalance/proposal?includeSavings=1')).json();
  assert.equal(withSav.includeSavings, true);
});
