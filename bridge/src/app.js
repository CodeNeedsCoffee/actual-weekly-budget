import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { weeklyPosition } from './weekly.js';
import { affordCheck } from './afford.js';
import { suggestCategory } from './suggest.js';
import { splitActions } from './splits.js';
import { splitSuggestionFor } from './split_rules.js';

function tokenMatches(given, expected) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// `actual` is an adapter around @actual-app/api so routes can be tested with a fake.
export function buildApp({ token, actual, splitRules = [], logger = false }) {
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
