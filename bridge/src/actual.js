import * as api from '@actual-app/api';
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
    close: () => api.shutdown(),
  };
}
