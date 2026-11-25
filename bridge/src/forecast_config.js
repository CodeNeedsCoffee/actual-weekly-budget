import { readFileSync, existsSync } from 'node:fs';

// Optional JSON file (kept out of git). Money is in cents. Example: forecast-config.example.json
const DEFAULTS = {
  checking: 'checking', // substring of the Checking account name
  savings: 'saving',
  payoffCard: '', // substring of the card account to pay down
  buffer: 100000,
  variablePerDay: 0, // estimated everyday spending paid from Checking
  balancingFrom: '', // first month (YYYY-MM) the month-end helper looks at
  baseIncome: {}, // optional { incomeCategoryName: cents } overriding the budgeted income base
  excludeIncome: ['starting balances'],
  items: [], // estimates for things Actual has no schedule for: { name, amount, dayOfMonth: [..] }
};

export function loadForecastConfig(path) {
  if (!path || !existsSync(path)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...JSON.parse(readFileSync(path, 'utf8')) };
}

export function findAccount(accounts, needle) {
  if (!needle) return null;
  const n = needle.toLowerCase();
  return accounts.find((a) => a.name.toLowerCase().includes(n)) ?? null;
}
