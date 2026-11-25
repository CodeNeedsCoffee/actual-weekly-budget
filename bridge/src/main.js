import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createActual } from './actual.js';
import { loadSplitRules } from './split_rules.js';
import { loadForecastConfig } from './forecast_config.js';
import { createLog } from './balancing_log.js';
import { join } from 'node:path';

const cfg = loadConfig();
const actual = await createActual(cfg);
const app = buildApp({ token: cfg.bridgeToken, actual, splitRules: loadSplitRules(cfg.splitRulesFile), forecastConfig: loadForecastConfig(cfg.forecastConfigFile), balancingLog: createLog(join(cfg.dataDir, 'balancing-log.json')), clientIpHeader: cfg.clientIpHeader, logger: true });
await app.listen({ port: cfg.port, host: cfg.host });
const stop = async () => { await app.close(); await actual.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
