# Build Plan: Weekly Grind (actual-weekly-budget)

Mobile app (Flutter) on top of the self-hosted Actual Budget server. Requirements are in `REQUIREMENTS.md`. Plan written 2026-11-23.

## 1. How the owner budgets (what the app must respect)
- Monthly budgets in Actual (tracking type), with carryover on for most categories, so a category's real position is its carried-over **balance**, not just this month's amount.
- Base income is a fixed monthly base for the primary earner (pay without bonuses) and a fixed monthly base for the partner (expected contract work). Anything above base (bonuses, extra contract work) is **extra** and goes to paying down overspent budgets. Months under base net against extras.
- Shopping is the catch-all and the deepest hole; Rent and Household also overspent. Goal is zero-sum, then staying within budget. Savings is touched last.
- A period of double rent is being absorbed with bonus money and transfers.
- Checking must not bounce; AMEX payoff is sized from Checking's projected balance, scheduled bills and the next paycheck, with a ~$1,000 buffer.
- Primary question the app answers: "Can I afford this this week?"

## 2. Architecture
Actual has no mobile-friendly API. Its data lives in a CRDT/SQLite sync protocol and the only supported client is the Node `@actual-app/api` (version must match the server, now 26.11.0). So:

```
Flutter app  --HTTPS/JSON-->  Bridge (Node, Docker on home server)  --@actual-app/api-->  Actual server (:15006)
```

- **bridge/**: small Node service (Fastify). Holds the Actual password, a long-lived budget session, and exposes a narrow REST API with a bearer token. All budgeting logic that needs the whole data set (afford check, suggestions, forecast, balancing proposals) lives here, is unit-tested with fixtures, and is reused by the app through JSON.
- **app/**: Flutter app (Riverpod, go_router, Material 3). Thin: renders bridge responses, handles gestures, caches last response for offline view.
- **Why not talk to Actual directly from Flutter:** no Dart client, sync protocol is not documented for third parties, and the bridge mirrors the scripts already proven in this project.
- **Access away from home:** LAN-only by default. Remote use needs Tailscale (or similar) on the phone and server. See open decisions.
- **Secrets:** Actual password and bridge token via environment variables / Docker secrets, never in the repo or the app source. The app stores the bridge URL and token in the platform keystore.

### Repo layout
```
actual-weekly-budget/
  docs/            REQUIREMENTS.md, PLAN.md
  bridge/          Node service, tests, Dockerfile, compose example
  app/             Flutter project
  tools/           one-off ops scripts (rules, cleanup), fixtures generator
```

## 3. Core logic (defined up front)
1. **Weekly view.** For a category: `available = balance (incl. carryover)`. Week = Sunday to Saturday. The week's allowance is the balance at the start of the week spread evenly over the days left in the month, times the days of this week that fall in the month; show spent this week, remaining this week, and month remaining. Overspent categories show their deficit and the carried negative explicitly. (Assumption, confirm.)
2. **Afford check.** Input amount + category (or suggest a category). Output: fits this week? fits this month? what the category balance becomes, plus a flag if it pushes Checking's 14-day forecast under buffer. Verdicts: Yes / Tight / No with the numbers shown.
3. **Category suggestions.** From payee history: match on normalized imported payee (strip store numbers, locations, `#1234`, `TST*`, `SQ *`). Suggest the most frequent category with count ("12 of 14 past Sprouts charges were Groceries"); fall back to fuzzy token match. Never auto-apply. Target is split 50/50 Groceries/Household, but the API cannot write splits, so Target goes to Shopping and the app flags it for the Actual UI.
4. **Refresh imports.** Trigger bank sync (`runBankSync`) through the bridge; show per-account last-synced and stale warnings (> 2 days).
5. **14-day forecast.** Start from Checking balance; apply scheduled items from today to +14 days (expand recurring schedules with the same rules Actual uses; use the worst case of `isbetween`/`isapprox` ranges); show AMEX/Partner card schedules separately; show lowest balance + date; show line with and without income (paychecks unscheduled, so use base estimates as a toggle: primary payroll roughly twice a month, last known amount; Partner excluded by default); suggest "move $X from Savings before <date>".
6. **Month-end balancing helper.** Inputs: per-category balances, extra-income pool. Proposal order: (a) cover overspent categories from the extra-income pool; (b) then from categories with surplus; (c) Savings last. Rules: budgets only increase from the pool, no negative budgets (except Savings pulled for the pool), carryover-aware (money added in a month carries forward), biggest deficit first, never more than the deficit. Always dry run first, show before/after overspend per month, apply on confirm, save the previous amounts so it can be reverted.
7. **Savings sweep.** Suggest an amount and source categories to reduce and move to Savings, only from categories with unused balance late in the month.
8. **AMEX payoff advisor.** From the forecast: projected Checking at each paycheck, outflows to the next paycheck, buffer, suggested payment (split before/after payday), with assumptions listed.
9. **Double-rent recovery tracker.** Remaining overspend per month and cumulative, extra income applied, remaining to recover.

## 4. Bridge API (draft)
All endpoints need `Authorization: Bearer <token>`.
- `GET /summary` : month overview, per-category balance/week allowance, uncategorized count, last-synced.
- `GET /weekly?date=` : weekly view.
- `POST /afford {amount, categoryId?, payee?}`
- `GET /transactions?uncategorized=1` and `POST /transactions/:id/category {categoryId}`
- `GET /suggest/:transactionId`
- `POST /sync` and `GET /sync/status`
- `GET /forecast?days=14&income=with|without`
- `GET /balancing/proposal?month=` and `POST /balancing/apply {proposalId}` and `POST /balancing/revert {backupId}`
- `GET /extra-income?from=&to=` (extra per month vs base, running pool)
- `GET /amex/advice`
- `GET /recovery` (double-rent tracker)

Writes allowed: set category on a transaction, split a transaction (`POST /transactions/:id/split`, via the client's internal `rule-apply-actions`), set budget amounts, run bank sync. No deletes.

## 5. Milestones
Each milestone ends with tests green and something usable. Order puts the "can I afford this?" answer first.

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffolding: repo layout, `flutter create`, bridge skeleton, CI-less local scripts, lint config, bridge Dockerfile, health endpoint, token auth | `flutter test`, bridge tests pass; app reaches `/health` on the LAN |
| M1 | Bridge read model: session management, categories/balances/carryover, weekly allowance, fixtures from a sanitized copy of the real budget | `/summary` and `/weekly` match Actual's UI numbers for Jun-Nov 2026 |
| M2 | App: this-week screen + category detail + afford check (Feature 1) | Answer "can I afford $X in category Y" on the phone |
| M3 | Uncategorized inbox + suggestions + one-tap categorize + Target handling (Features 2, 3) | Swipe through backlog; writes verified in Actual |
| M4 | Refresh imports + staleness (Feature 4) | Button triggers sync; stale accounts flagged |
| M5 | 14-day forecast + AMEX advisor (Feature 7, section 3.8) | Matches the hand analysis (low point, card payoff advice) |
| M6 | Balancing helper + extra-income pool + revert (Features 5, 6) | Dry run reproduces a hand-verified plan; apply and revert work |
| M7 (done) | Recovery tracker, savings sweep, polish (themes, empty/error states, offline cache, app icon) | End-to-end week of daily use |
| M8 | Packaging: release APK, bridge image on the home server (compose), Tugtainer-managed, backup and restore notes | Installed on the phone, bridge running on server |

## 6. Testing
- Bridge: unit tests for every algorithm against fixtures (including carryover edge cases, tombstoned duplicate categories, `isbetween` forecasts, the May splits). Golden tests that reproduce hand-verified results from a private fixture (kept out of git).
- Write paths tested against a throwaway copy of the budget, never first against live data.
- App: widget tests for each screen, a few integration tests against a fake bridge; checked on the emulator and on a real phone.
- Safety: every write is idempotent (absolute amounts), logged, and has a revert file.

## 7. Risks and decisions already made
- Client/server version coupling: pin `@actual-app/api` to the server version; bridge startup checks for mismatch and reports it in `/health` (we hit `invalid-schema` on 26.5.2 vs 26.11.0).
- Tombstoned duplicate categories: always filter deleted and key by ID, never name.
- Splits: the public API cannot write them, but the internal `rule-apply-actions` handler can (no rule needed). Unsupported API surface, so keep the client pinned and keep the live check; fall back to flagging split-needed transactions if it ever breaks.
- Bank sync is SimpleFIN (beta, 90-day cap); the app must tolerate gaps.
- Paychecks are unscheduled; forecast treats income as a toggle with a base-pay estimate.
- No auto-apply: suggestions and balancing moves always need a tap.

## 8. Open decisions (need your answer before the milestone named)
1. **Remote access (M0):** LAN-only, or Tailscale for use away from home? (Recommended: Tailscale.)
2. **Week boundaries (M1):** Sunday to Saturday (confirmed). Remaining-weeks method OK as written?
3. **Platform (M0):** Android only (you install debug APKs now) or iOS too?
4. **App name (M7):** "Weekly Grind" (chosen). The repo and code keep the working name `actual-weekly-budget` / `weekly_budget`.
5. **Commits:** I won't commit or push unless you say so.

## 9. First steps once approved
1. M0 scaffolding in `bridge/` and `app/` (no commit).
2. Capture a sanitized fixture of the live budget for M1 tests.
3. Build M1 and M2 so you can check an affordability answer on your phone first.
