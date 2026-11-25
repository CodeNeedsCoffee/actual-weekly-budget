// Reads settings from the environment; secrets are never stored in the repo.
export function loadConfig(env = process.env) {
  const need = (k) => {
    if (!env[k]) throw new Error(`missing env var ${k}`);
    return env[k];
  };
  const bridgeToken = need('BRIDGE_TOKEN');
  // The bridge can move budget money, so a guessable token is not acceptable. ALLOW_WEAK_TOKEN is for local tests only.
  if (bridgeToken.length < 32 && env.ALLOW_WEAK_TOKEN !== '1') {
    throw new Error('BRIDGE_TOKEN must be at least 32 characters (try: openssl rand -hex 24)');
  }
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    bridgeToken,
    actualUrl: need('ACTUAL_URL'),
    actualPassword: need('ACTUAL_PASSWORD'),
    budgetId: need('ACTUAL_BUDGET_ID'),
    dataDir: env.DATA_DIR ?? './data',
    splitRulesFile: env.SPLIT_RULES_FILE ?? '',
    forecastConfigFile: env.FORECAST_CONFIG_FILE ?? '',
    clientIpHeader: (env.CLIENT_IP_HEADER ?? '').toLowerCase(),
  };
}
