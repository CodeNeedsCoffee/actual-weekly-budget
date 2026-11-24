import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { weeklyPosition } from './weekly.js';
import { affordCheck } from './afford.js';

function tokenMatches(given, expected) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// `actual` is an adapter around @actual-app/api so routes can be tested with a fake.
export function buildApp({ token, actual, logger = false }) {
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

  return app;
}
