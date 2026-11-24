import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';

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

  return app;
}
