import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { weeklyPosition } from './weekly.js';
import { affordCheck } from './afford.js';
import { suggestCategory } from './suggest.js';
import { splitActions } from './splits.js';
import { splitSuggestionFor } from './split_rules.js';
import { forecast, payoffAdvice } from './forecast.js';
import { findAccount } from './forecast_config.js';
import { planExtraIncome, planId } from './balancing.js';
import { planRebalance } from './rebalance.js';
import { planSweep } from './sweep.js';

function tokenMatches(given, expected) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// `actual` is an adapter around @actual-app/api so routes can be tested with a fake.
export function buildApp({ token, actual, splitRules = [], forecastConfig = {}, balancingLog = null, logger = false }) {
  const fcfg = { checking: 'checking', savings: 'saving', payoffCard: '', buffer: 100000, variablePerDay: 0, items: [], ...forecastConfig };
  const app = Fastify({ logger });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!tokenMatches(given, token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({
    ok: true,
    apiClientVersion: actual.clientVersion(),
  }));

  app.get('/summary', async () => actual.summary());

  const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');

  // Per-category weekly position. `actual.categories(today)` returns
  // [{ id, name, group, balance, spentThisWeek }] in cents.
  app.get('/weekly', async (req, reply) => {
    const today = req.query.date ?? actual.today();
    if (!dateOk(today)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    const cats = await actual.categories(today);
    return {
      date: today,
      categories: cats.map((c) => ({
        id: c.id,
        name: c.name,
        group: c.group,
        ...weeklyPosition({ today, balance: c.balance, spentThisWeek: c.spentThisWeek }),
      })),
    };
  });

  app.post('/afford', async (req, reply) => {
    const { amount, categoryId, date } = req.body ?? {};
    const today = date ?? actual.today();
    if (!Number.isInteger(amount) || amount <= 0 || !categoryId || !dateOk(today)) {
      return reply.code(400).send({ error: 'amount (cents), categoryId and optional date required' });
    }
    const cat = (await actual.categories(today)).find((c) => c.id === categoryId);
    if (!cat) return reply.code(404).send({ error: 'unknown category' });
    const position = weeklyPosition({ today, balance: cat.balance, spentThisWeek: cat.spentThisWeek });
    return { category: cat.name, ...affordCheck({ amount, position }) };
  });

  app.get('/sync/status', async () => ({ accounts: await actual.syncStatus() }));

  // Runs the bank sync (all accounts, or one) and returns fresh status. One run at a time.
  let syncing = false;
  app.post('/sync', async (req, reply) => {
    if (syncing) return reply.code(409).send({ error: 'sync already running' });
    syncing = true;
    try {
      const result = await actual.runSync(req.body?.accountId);
      return { ...result, accounts: await actual.syncStatus() };
    } finally {
      syncing = false;
    }
  });

  async function runForecast(days, { amountMode = 'worst', incomeDelayDays = 0 } = {}) {
    const { accounts, schedules } = await actual.forecastInputs();
    const checking = findAccount(accounts, fcfg.checking);
    if (!checking) return { error: 'checking account not found (set "checking" in the forecast config)' };
    const savings = findAccount(accounts, fcfg.savings);
    const fc = forecast({
      today: actual.today(),
      days,
      checkingBalance: checking.balance,
      savingsBalance: savings?.balance ?? 0,
      checkingId: checking.id,
      schedules,
      adjustments: { variablePerDay: fcfg.variablePerDay, items: fcfg.items },
      buffer: fcfg.buffer,
      amountMode,
      incomeDelayDays,
    });
    return { fc, accounts };
  }

  // 14-day (default) cash forecast for Checking. `fc.path` has balances with and without income.
  app.get('/forecast', async (req, reply) => {
    const days = Math.min(60, Math.max(1, Number(req.query.days ?? 14)));
    if (!Number.isInteger(days)) return reply.code(400).send({ error: 'days must be a whole number' });
    const r = await runForecast(days);
    if (r.error) return reply.code(422).send({ error: r.error });
    return r.fc;
  });

  // How much of the card balance can be paid from Checking now (looks 21 days ahead).
  app.get('/payoff', async (req, reply) => {
    const onTime = await runForecast(21, { amountMode: 'expected' });
    if (onTime.error) return reply.code(422).send({ error: onTime.error });
    const late = await runForecast(21, { amountMode: 'expected', incomeDelayDays: fcfg.incomeLateDays ?? 7 });
    const card = findAccount(onTime.accounts, fcfg.payoffCard);
    if (!card) return reply.code(422).send({ error: 'card account not found (set "payoffCard" in the forecast config)' });
    return {
      card: card.name,
      incomeLateDays: fcfg.incomeLateDays ?? 7,
      ...payoffAdvice(onTime.fc, late.fc, Math.max(0, -card.balance)),
    };
  });

  // ---- Month-end helper: spend extra income (above the income base) on overspent categories ----
  const monthOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '');
  const monthsBetween = (from, to) => {
    const out = [];
    let [y, m] = from.split('-').map(Number);
    while (`${y}-${String(m).padStart(2, '0')}` <= to) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  };
  const lastFullMonth = () => {
    let [y, m] = actual.today().slice(0, 7).split('-').map(Number);
    if (--m < 1) { m = 12; y--; }
    return `${y}-${String(m).padStart(2, '0')}`;
  };
  const incomeOpts = { baseIncome: fcfg.baseIncome ?? {}, excludeIncome: fcfg.excludeIncome ?? ['starting balances'] };

  async function buildPlan(from, to) {
    const months = await actual.balancingMonths(monthsBetween(from, to), incomeOpts);
    const plan = planExtraIncome({ months, used: balancingLog.used() });
    return { ...plan, id: planId(plan.cells), from, to };
  }
  const range = (q) => {
    const from = q.from || fcfg.balancingFrom;
    const to = q.to || lastFullMonth();
    return monthOk(from) && monthOk(to) && from <= to ? { from, to } : null;
  };

  // ---- Zero-sum rebalance: move spare budget into overspent categories (Savings only if asked, last) ----
  async function flaggedMonths(from, to) {
    const savings = (fcfg.savingsCategory ?? 'Savings').toLowerCase();
    const protectedNames = new Set((fcfg.protect ?? []).map((n) => n.toLowerCase()));
    return (await actual.balancingMonths(monthsBetween(from, to), incomeOpts)).map((m) => ({
      month: m.month,
      cats: m.cats.map((c) => ({
        ...c,
        isSavings: c.name.toLowerCase() === savings,
        protected: protectedNames.has(c.name.toLowerCase()),
      })),
    }));
  }

  async function buildRebalance(from, to, includeSavings) {
    const plan = planRebalance({ months: await flaggedMonths(from, to), includeSavings });
    return { ...plan, id: planId(plan.cells), from, to, includeSavings };
  }

  const rebalanceRange = (src) => {
    const to = src.to || lastFullMonth();
    const from = src.from || to; // the month that just ended, unless a range is given
    return monthOk(from) && monthOk(to) && from <= to ? { from, to } : null;
  };

  app.get('/rebalance/proposal', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const r = rebalanceRange(req.query);
    if (!r) return reply.code(400).send({ error: 'from/to must be YYYY-MM' });
    return buildRebalance(r.from, r.to, req.query.includeSavings === '1');
  });

  app.post('/rebalance/apply', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const r = rebalanceRange(req.body ?? {});
    if (!r) return reply.code(400).send({ error: 'from/to must be YYYY-MM' });
    const plan = await buildRebalance(r.from, r.to, req.body?.includeSavings === true);
    if (req.body?.id !== plan.id) return reply.code(409).send({ error: 'plan changed since the preview', id: plan.id });
    if (plan.cells.length === 0) return { ok: true, applied: 0 };
    for (const c of plan.cells) await actual.setBudget(c.month, c.categoryId, c.to);
    const entry = { id: `rebalance-${Date.now()}`, at: new Date().toISOString(), kind: 'rebalance', used: {}, moved: plan.total, cells: plan.cells };
    balancingLog.add(entry);
    return { ok: true, applied: plan.cells.length, total: plan.total, logId: entry.id };
  });

  // ---- Savings sweep: move free budget (left after overspent categories are covered) into Savings ----
  async function buildSweep(month, amount) {
    const plan = planSweep({ months: await flaggedMonths(month, month), amount });
    if (plan.error) return plan;
    // Moving real cash to the Savings account must not cause a bounce in the next 14 days.
    let cash = null;
    const r = plan.total > 0 ? await runForecast(14) : null;
    if (r && !r.error) {
      const lowAfter = r.fc.lowWithoutIncome.amount - plan.total;
      cash = { lowAfter, lowDate: r.fc.lowWithoutIncome.date, buffer: r.fc.buffer, safe: lowAfter >= r.fc.buffer };
    }
    return { ...plan, id: planId(plan.cells), amountRequested: amount, cash };
  }
  const sweepParams = (src) => {
    const month = src.month || lastFullMonth();
    const raw = src.amount;
    const amount = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    if (!monthOk(month) || (amount !== null && (!Number.isInteger(amount) || amount < 0))) return null;
    return { month, amount };
  };

  app.get('/sweep/proposal', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const p = sweepParams(req.query);
    if (!p) return reply.code(400).send({ error: 'month must be YYYY-MM and amount whole cents' });
    const plan = await buildSweep(p.month, p.amount);
    return plan.error ? reply.code(422).send(plan) : plan;
  });

  app.post('/sweep/apply', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const p = sweepParams(req.body ?? {});
    if (!p) return reply.code(400).send({ error: 'month must be YYYY-MM and amount whole cents' });
    const plan = await buildSweep(p.month, p.amount);
    if (plan.error) return reply.code(422).send(plan);
    if (req.body?.id !== plan.id) return reply.code(409).send({ error: 'plan changed since the preview', id: plan.id });
    if (plan.cells.length === 0) return { ok: true, applied: 0 };
    for (const c of plan.cells) await actual.setBudget(c.month, c.categoryId, c.to);
    const entry = { id: `sweep-${Date.now()}`, at: new Date().toISOString(), kind: 'sweep', used: {}, moved: plan.total, cells: plan.cells };
    balancingLog.add(entry);
    return { ok: true, applied: plan.cells.length, total: plan.total, logId: entry.id };
  });

  app.get('/balancing/proposal', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const r = range(req.query);
    if (!r) return reply.code(400).send({ error: 'from/to must be YYYY-MM (set balancingFrom in the config)' });
    return buildPlan(r.from, r.to);
  });

  app.post('/balancing/apply', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const r = range(req.body ?? {});
    if (!r) return reply.code(400).send({ error: 'from/to must be YYYY-MM' });
    const plan = await buildPlan(r.from, r.to);
    if (req.body?.id !== plan.id) return reply.code(409).send({ error: 'plan changed since the preview', id: plan.id });
    if (plan.cells.length === 0) return reply.code(200).send({ ok: true, applied: 0 });
    for (const c of plan.cells) await actual.setBudget(c.month, c.categoryId, c.to);
    const used = {};
    for (const c of plan.cells) used[c.month] = (used[c.month] ?? 0) + (c.to - c.from);
    const entry = { id: `apply-${Date.now()}`, at: new Date().toISOString(), kind: 'apply', used, cells: plan.cells };
    balancingLog.add(entry);
    return { ok: true, applied: plan.cells.length, total: plan.totalAllocated, logId: entry.id };
  });

  // Mark extra income as already spent (for changes made outside the app).
  app.post('/balancing/record', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const { month, amount } = req.body ?? {};
    if (!monthOk(month) || !Number.isInteger(amount) || amount <= 0) {
      return reply.code(400).send({ error: 'month (YYYY-MM) and amount (cents) required' });
    }
    const entry = { id: `manual-${Date.now()}`, at: new Date().toISOString(), kind: 'manual', used: { [month]: amount }, cells: [] };
    balancingLog.add(entry);
    return { ok: true, logId: entry.id };
  });

  app.get('/balancing/log', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    return { entries: balancingLog.entries().map((e) => ({ id: e.id, at: e.at, kind: e.kind, used: e.used, moved: e.moved ?? 0, cells: e.cells.length })) };
  });

  // Restores the previous budget amounts. A cell someone has changed since is left alone and reported.
  app.post('/balancing/revert', async (req, reply) => {
    if (!balancingLog) return reply.code(501).send({ error: 'balancing is not enabled' });
    const entry = balancingLog.get(req.body?.id);
    if (!entry) return reply.code(404).send({ error: 'no such log entry' });
    const months = [...new Set(entry.cells.map((c) => c.month))];
    const now = months.length ? await actual.balancingMonths(months, incomeOpts) : [];
    const current = new Map(now.flatMap((m) => m.cats.map((c) => [`${m.month}|${c.id}`, c.budgeted])));
    const conflicts = [];
    let restored = 0;
    for (const c of entry.cells) {
      if (current.get(`${c.month}|${c.categoryId}`) !== c.to) {
        conflicts.push({ month: c.month, categoryId: c.categoryId, name: c.name });
        continue;
      }
      await actual.setBudget(c.month, c.categoryId, c.from);
      restored++;
    }
    if (conflicts.length === 0) balancingLog.remove(entry.id);
    return { ok: conflicts.length === 0, restored, conflicts };
  });

  app.get('/categories', async () => ({ categories: await actual.listCategories() }));

  // Uncategorized inbox, newest first, each with an optional suggestion (never auto-applied).
  app.get('/transactions/uncategorized', async () => {
    const today = actual.today();
    const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    const [txs, history, cats] = await Promise.all([
      actual.uncategorized(),
      actual.history(since),
      actual.listCategories(),
    ]);
    const names = new Map(cats.map((c) => [c.id, c.name]));
    return {
      transactions: txs.map((t) => {
        const s = suggestCategory(t.payee, history);
        const name = s && names.get(s.categoryId);
        return {
          ...t,
          splitSuggestion: t.amount < 0 ? splitSuggestionFor(t.payee, splitRules, cats) : null,
          suggestion: name
            ? {
                categoryId: s.categoryId,
                categoryName: name,
                reason: `${s.count} of ${s.total} past "${t.payee}" charges ${s.match === 'exact' ? '' : '(similar names) '}were ${name}`.replace('  ', ' '),
              }
            : null,
        };
      }),
    };
  });

  app.post('/transactions/:id/category', async (req, reply) => {
    const { categoryId } = req.body ?? {};
    const cats = await actual.listCategories();
    if (!categoryId || !cats.some((c) => c.id === categoryId)) {
      return reply.code(400).send({ error: 'unknown categoryId' });
    }
    await actual.setCategory(req.params.id, categoryId);
    return { ok: true };
  });

  // Body: { parts: [{ categoryId, percent? }] }; one part may omit percent (takes the remainder).
  app.post('/transactions/:id/split', async (req, reply) => {
    const parts = req.body?.parts;
    try {
      splitActions(parts);
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
    const cats = await actual.listCategories();
    if (!parts.every((p) => cats.some((c) => c.id === p.categoryId))) {
      return reply.code(400).send({ error: 'unknown categoryId' });
    }
    const res = await actual.splitTransaction(req.params.id, parts);
    if (res.error === 'not found') return reply.code(404).send(res);
    if (res.error) return reply.code(409).send(res);
    return { ok: true };
  });

  return app;
}
