// Reads settings from the environment; secrets are never stored in the repo.
export function loadConfig(env = process.env) {
  const need = (k) => {
    if (!env[k]) throw new Error(`missing env var ${k}`);
    return env[k];
  };
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    bridgeToken: need('BRIDGE_TOKEN'),
    actualUrl: need('ACTUAL_URL'),
    actualPassword: need('ACTUAL_PASSWORD'),
    budgetId: need('ACTUAL_BUDGET_ID'),
    dataDir: env.DATA_DIR ?? './data',
    splitRulesFile: env.SPLIT_RULES_FILE ?? '',
  };
}
