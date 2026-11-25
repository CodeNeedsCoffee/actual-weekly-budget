import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountSyncStatus } from '../src/sync_status.js';

const now = Date.UTC(2026, 10, 24, 12, 0, 0);

test('recent sync is fresh', () => {
  const s = accountSyncStatus({ lastSync: String(now - 3 * 3600000), latestTransaction: '2026-11-23' }, now);
  assert.equal(s.hoursAgo, 3);
  assert.equal(s.stale, false);
  assert.equal(s.latestTransaction, '2026-11-23');
});

test('older than 48 hours is stale', () => {
  assert.equal(accountSyncStatus({ lastSync: String(now - 49 * 3600000) }, now).stale, true);
  assert.equal(accountSyncStatus({ lastSync: String(now - 48 * 3600000) }, now).stale, false);
});

test('never synced is stale with no timestamp', () => {
  const s = accountSyncStatus({ lastSync: null }, now);
  assert.equal(s.stale, true);
  assert.equal(s.lastSync, null);
});
