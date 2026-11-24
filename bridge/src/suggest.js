// Category suggestions from past transactions. Never applied automatically.

const NOISE_PREFIX = /^(tst|sq|pp|paypal|pos|debit|purchase|checkcard|recurring)\s*[*\-:]*\s*/i;

// "SPROUTS FARMERS MKT #123 SAN DIEGO CA" -> ["sprouts", "farmers", "mkt"]
export function payeeTokens(raw) {
  let s = String(raw ?? '').toLowerCase().trim();
  s = s.replace(NOISE_PREFIX, '');
  s = s.replace(/[#*]\s*\d+/g, ' ').replace(/[^a-z\s&]/g, ' ');
  const tokens = s.split(/\s+/).filter((t) => t.length > 1);
  return tokens.filter((t) => !/^[a-z]$/.test(t));
}

export const payeeKey = (raw) => payeeTokens(raw).slice(0, 2).join(' ');
const firstToken = (raw) => payeeTokens(raw)[0] ?? '';

/**
 * @param {string} payee
 * @param {{payee: string, categoryId: string}[]} history  categorized past transactions
 * @returns {null | {categoryId, count, total, match, reason}} reason is filled by the caller (needs names)
 */
export function suggestCategory(payee, history) {
  const key = payeeKey(payee);
  if (!key) return null;
  const tiers = [
    ['exact', (h) => payeeKey(h.payee) === key],
    ['first-word', (h) => firstToken(h.payee) === firstToken(payee)],
  ];
  for (const [match, test] of tiers) {
    const hits = history.filter((h) => h.categoryId && test(h));
    if (hits.length === 0) continue;
    const counts = new Map();
    for (const h of hits) counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1);
    const [categoryId, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { categoryId, count, total: hits.length, match };
  }
  return null;
}
