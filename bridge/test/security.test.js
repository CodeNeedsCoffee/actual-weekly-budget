import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../src/security.js';
import { loadConfig } from '../src/config.js';

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
};

test('locks an address after repeated failures, for a limited time', () => {
  const c = clock();
  const g = createGuard({ maxFailures: 3, lockMs: 60_000, now: c.now });
  for (let i = 0; i < 2; i++) { assert.equal(g.check('a'), null); g.failure('a'); }
  assert.equal(g.check('a'), null);
  g.failure('a'); // third failure
  assert.deepEqual(g.check('a'), { retryAfter: 60 });
  assert.equal(g.check('b'), null); // others are unaffected
  c.tick(61_000);
  assert.equal(g.check('a'), null);
});

test('a success clears the failure count; old failures age out', () => {
  const c = clock();
  const g = createGuard({ maxFailures: 3, windowMs: 10_000, now: c.now });
  g.failure('a'); g.failure('a'); g.success('a'); g.failure('a'); g.failure('a');
  assert.equal(g.check('a'), null);
  c.tick(20_000);
  g.failure('a'); g.failure('a'); // window restarted, so still below three
  assert.equal(g.check('a'), null);
});

test('limits request rate per minute and recovers in the next minute', () => {
  const c = clock(60_000 * 100);
  const g = createGuard({ perMinute: 5, now: c.now });
  for (let i = 0; i < 5; i++) assert.equal(g.check('a'), null);
  assert.ok(g.check('a').retryAfter >= 1);
  c.tick(60_000);
  assert.equal(g.check('a'), null);
});

test('config refuses a short token unless explicitly allowed for tests', () => {
  const env = { BRIDGE_TOKEN: 'short', ACTUAL_URL: 'u', ACTUAL_PASSWORD: 'p', ACTUAL_BUDGET_ID: 'b' };
  assert.throws(() => loadConfig(env), /at least 32/);
  assert.equal(loadConfig({ ...env, ALLOW_WEAK_TOKEN: '1' }).bridgeToken, 'short');
  assert.equal(loadConfig({ ...env, BRIDGE_TOKEN: 'x'.repeat(32), CLIENT_IP_HEADER: 'CF-Connecting-IP' }).clientIpHeader, 'cf-connecting-ip');
});
