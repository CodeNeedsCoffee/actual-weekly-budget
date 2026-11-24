import * as api from '@actual-app/api';
import { readFileSync } from 'node:fs';

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
    close: () => api.shutdown(),
  };
}
