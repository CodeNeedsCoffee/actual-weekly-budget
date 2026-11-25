import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Remembers which extra income has been spent, so a plan is never applied twice, and the previous
// budget amounts so an apply can be reverted. Stored as JSON in the bridge data directory.
export function createLog(path) {
  const load = () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { entries: [] });
  const save = (log) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(log, null, 1));
  };
  return {
    entries: () => load().entries,
    used() {
      const used = {};
      for (const e of load().entries) {
        for (const [month, cents] of Object.entries(e.used)) used[month] = (used[month] ?? 0) + cents;
      }
      return used;
    },
    add(entry) {
      const log = load();
      log.entries.push(entry);
      save(log);
    },
    remove(id) {
      const log = load();
      const entry = log.entries.find((e) => e.id === id);
      if (!entry) return null;
      log.entries = log.entries.filter((e) => e.id !== id);
      save(log);
      return entry;
    },
    get: (id) => load().entries.find((e) => e.id === id) ?? null,
  };
}
