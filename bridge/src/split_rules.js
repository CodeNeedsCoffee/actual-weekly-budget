import { readFileSync, existsSync } from 'node:fs';
import { payeeTokens } from './suggest.js';

// Rules: [{ match: "target", parts: [{ category: "Groceries", percent: 50 }, { category: "Household" }] }]
// `match` must equal one whole word of the normalized payee (so wallet prefixes like "Apple Pay" don't matter). Categories are matched by name.
export function loadSplitRules(path) {
  if (!path || !existsSync(path)) return [];
  const rules = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(rules)) throw new Error('split rules file must be a JSON array');
  return rules;
}

// Returns { label, parts: [{ categoryId, percent? }] } or null when no rule applies or a category is unknown.
export function splitSuggestionFor(payee, rules, categories) {
  const tokens = payeeTokens(payee);
  const rule = rules.find((r) => tokens.includes(String(r.match).toLowerCase()));
  if (!rule) return null;
  const parts = [];
  for (const p of rule.parts) {
    const cat = categories.find((c) => !c.isIncome && c.name === p.category);
    if (!cat) return null;
    parts.push(p.percent == null ? { categoryId: cat.id } : { categoryId: cat.id, percent: p.percent });
  }
  const label = rule.parts.map((p) => (p.percent == null ? p.category : `${p.percent}% ${p.category}`)).join(' + ');
  return { label: `Split ${label}`, parts };
}
