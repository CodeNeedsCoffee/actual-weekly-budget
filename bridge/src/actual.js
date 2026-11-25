import * as api from '@actual-app/api';
import apiCjs from '@actual-app/api';
import { splitActions } from './splits.js';
import { accountSyncStatus } from './sync_status.js';
import { readFileSync } from 'node:fs';
import { weekBounds, monthBounds } from './weekly.js';

// Per-category balance (carryover included) and spend so far this week within the month.
// Only live (non-deleted, non-hidden, non-income) categories; keyed by id, never by name.
export async function readCategories(client, today) {
  const month = today.slice(0, 7);
  const bm = await client.getBudgetMonth(month);
  const week = weekBounds(today);
  const mb = monthBounds(today);
  const from = week.start > mb.start ? week.start : mb.start;
  const to = week.end < mb.end ? week.end : mb.end;
  const { data } = await client.runQuery(
    client
      .q('transactions')
      .filter({ date: { $gte: from, $lte: to }, category: { $ne: null } })
      .select(['category', 'amount']),
  );
  const spent = new Map();
  for (const t of data) spent.set(t.category, (spent.get(t.category) ?? 0) - t.amount);
  const out = [];
  for (const g of bm.categoryGroups) {
    if (g.is_income) continue;
    for (const c of g.categories) {
      out.push({
        id: c.id,
        name: c.name,
        group: g.name,
        balance: c.balance,
        spentThisWeek: Math.max(0, spent.get(c.id) ?? 0),
      });
    }
  }
  return out;
}

// Live, selectable categories (expense and income), keyed by id.
export async function readCategoryList(client) {
  const groups = await client.getCategoryGroups();
  return groups
    .filter((g) => !g.hidden)
    .flatMap((g) =>
      g.categories
        .filter((c) => !c.hidden)
        .map((c) => ({ id: c.id, name: c.name, group: g.name, isIncome: !!g.is_income })),
    );
}

// On-budget, non-transfer, non-split-parent transactions with no category.
export async function readUncategorized(client) {
  const { data } = await client.runQuery(
    client
      .q('transactions')
      .filter({
        category: null,
        is_parent: false,
        'account.offbudget': false,
        'payee.transfer_acct': null,
      })
      .select(['id', 'date', 'amount', 'payee.name', 'imported_payee', 'account.name', 'notes'])
      .orderBy({ date: 'desc' }),
  );
  return data.map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    payee: t.imported_payee || t['payee.name'] || '',
    account: t['account.name'],
    notes: t.notes ?? '',
  }));
}

// Categorized transactions from the last year, used to learn payee -> category.
export async function readHistory(client, sinceDate) {
  const { data } = await client.runQuery(
    client
      .q('transactions')
      .filter({ category: { $ne: null }, date: { $gte: sinceDate } })
      .select(['imported_payee', 'payee.name', 'category']),
  );
  return data.map((t) => ({ payee: t.imported_payee || t['payee.name'] || '', categoryId: t.category }));
}

// Splits an existing transaction by applying rule-style actions directly (no rule is created).
// Uses the client's internal `rule-apply-actions` handler, which is not a public API, so the
// bridge pins the client version and this is covered by the live checks in docs/DEV.md.
export async function splitExisting(client, internal, id, parts) {
  const { data } = await client.runQuery(
    client.q('transactions').filter({ id }).select(['*']).options({ splits: 'all' }),
  );
  const t = data[0];
  if (!t) return { error: 'not found' };
  if (t.is_parent || t.is_child) return { error: 'already split' };
  const res = await internal.send('rule-apply-actions', { transactions: [t], actions: splitActions(parts) });
  if (!res || res.errors?.length) return { error: 'split failed' };
  return { ok: true };
}

// Open, on-budget accounts that use a bank sync source, with freshness info.
export async function readSyncStatus(client, nowMs) {
  const { data: accounts } = await client.runQuery(
    client
      .q('accounts')
      .filter({ closed: false, offbudget: false })
      .select(['id', 'name', 'last_sync', 'account_sync_source']),
  );
  const out = [];
  for (const a of accounts) {
    if (!a.account_sync_source) continue;
    const { data } = await client.runQuery(
      client
        .q('transactions')
        .filter({ account: a.id, is_child: false })
        .orderBy({ date: 'desc' })
        .limit(1)
        .select(['date']),
    );
    out.push({
      id: a.id,
      name: a.name,
      ...accountSyncStatus({ lastSync: a.last_sync, latestTransaction: data[0]?.date }, nowMs),
    });
  }
  return out;
}

// Everything the forecast needs: account balances and normalized schedules.
export async function readForecastInputs(client) {
  const accounts = [];
  for (const a of await client.getAccounts()) {
    if (a.closed || a.offbudget) continue;
    accounts.push({ id: a.id, name: a.name, balance: await client.getAccountBalance(a.id) });
  }
  const { data } = await client.runQuery(
    client
      .q('schedules')
      .select(['id', 'name', 'next_date', '_account', '_amount', '_amountOp', '_date', 'completed', '_payee']),
  );
  const schedules = data.map((s) => ({
    id: s.id,
    name: s.name || '(unnamed)',
    accountId: s._account,
    amount: s._amount,
    op: s._amountOp,
    dateCfg: s._date,
    nextDate: s.next_date,
    completed: !!s.completed,
  }));
  return { accounts, schedules };
}

// Thin adapter over @actual-app/api. The client version must match the server.
export async function createActual(cfg) {
  await api.init({
    dataDir: cfg.dataDir,
    serverURL: cfg.actualUrl,
    password: cfg.actualPassword,
  });
  await api.downloadBudget(cfg.budgetId);
  const pkg = JSON.parse(
    readFileSync(new URL('../node_modules/@actual-app/api/package.json', import.meta.url)),
  );
  return {
    clientVersion: () => pkg.version,
    summary: async () => {
      const accounts = await api.getAccounts();
      return { accounts: accounts.length };
    },
    today: () => new Date().toISOString().slice(0, 10),
    categories: (today) => readCategories(api, today),
    listCategories: () => readCategoryList(api),
    uncategorized: () => readUncategorized(api),
    history: (since) => readHistory(api, since),
    setCategory: async (id, categoryId) => {
      await api.updateTransaction(id, { category: categoryId });
    },
    splitTransaction: (id, parts) => splitExisting(api, apiCjs.internal, id, parts),
    syncStatus: () => readSyncStatus(api, Date.now()),
    runSync: async (accountId) => {
      try {
        await api.runBankSync(accountId ? { accountId } : undefined);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
    forecastInputs: () => readForecastInputs(api),
    close: () => api.shutdown(),
  };
}
