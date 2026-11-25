# Actual Budget Mobile App: Requirements

Flutter mobile app on top of the self-hosted Actual Budget server. Last updated 2026-11-23.

## Primary goal
Look at something this week and understand whether it is within budget to buy. Everything else supports that.

## Look and feel
- Modern, clean UI. Flutter.

## Features

### 1. Weekly budget view
- Take the monthly budgets and give a weekly view.
- "Can I afford this?" check: enter an amount and category, see whether it fits this week's remaining budget and the category's carried-over balance.
- Budgets carry over month to month (carryover is on for 37 categories), so the weekly figure must use the carried-over balance, not only the month's budgeted amount.

### 2. Recategorize uncategorized transactions
- Easy, fast recategorizing of uncategorized transactions (swipe or tap, minimal steps).
- Show how many are uncategorized.
- Splits: Target is always split 50/50 Groceries / Household Items. The app applies it with one tap through the bridge split endpoint.
- Shopping is the catch-all category for now.

### 3. Category suggestions
- Suggest a category from historical categories or from similarly named transactions (match on imported payee, ignoring store numbers and locations).
- Show why it was suggested ("12 of 14 past 'Sprouts' charges were Groceries").
- Never auto-apply; one tap to accept.

### 4. Refresh transaction imports
- Button to trigger a bank sync (SimpleFIN) from the app.
- Show per-account "last synced" and warn when an account is stale, so missing transactions are caught early.
- Actual 26.11.0 also has a built-in sync interval, but it only runs while Actual is open.

### 5. Month-end balancing helper
- Goal: bring the budget as close to zero as possible at month end.
- The user sometimes saves in one category and overspends in others.
- Cover overspent categories by moving from other budgets first, and from Savings last.
- Show the suggested moves and apply them on confirmation.
- Extra income covers overspending (net pool): base income is a fixed monthly base for the primary earner (pay without bonuses) and a fixed monthly base for the partner (expected contract work); these are the income budgets. Anything above base (bonuses, extra contract work) is "extra" and goes to overspent budgets. A month under base subtracts from the pool, so extras and shortfalls net across months (running pool, never below zero when allocating).
- Allocate each month's available extra to that month's most overspent categories first, never more than the deficit, budgets only go up. Account for carryover: money added in one month carries into later months where carryover is on.
- Savings is pulled last. Savings is a budget category fed by interest and small deposits (carryover off), so only that month's activity is available.
- Show a dry run (per month: extra, where it goes, overspend before/after) and apply on confirmation; save the previous amounts so it can be reverted.
- Income categories: Primary, Partner, Starting Balances. Partner payroll payroll is Partner's pay; Primary payroll is Primary's. Rules route them accordingly.

### 6. Move money into savings
- Periodically move money into savings by reducing a budget, so the money is pulled from the budget and put into savings.
- Suggest how much and from which categories.

### 7. 14-day cash forecast (can Checking bounce?)
- Look at the next 14 days of scheduled bills against the Checking balance and warn if the balance would go negative or under a buffer.
- Show the lowest balance and its date.
- Use the worst case for range-based amounts ("between" / "approximately").
- Credit-card schedules (AMEX, Partner's card) do not hit Checking until the card is paid; show them separately.
- Show the balance with and without income, so a late paycheck is visible.
- Offer a fix: "move $X from Savings before <date>."
- Needs accurate schedules (see data issues below).

## Double-rent recovery
- A move caused a period of overlapping rent. The old rent is finished.
- Plan: zero-sum rebalance of Jun-Oct 2026 (done), then absorb the remainder with bonus money and transfers, then stay within budget.
- The app should show the remaining overspend per month and cumulative, what extra income has been applied, and how much is left to recover.

## Data and server facts
- Actual Budget sync-server 26.11.0, Docker on home server, port 15006. Budget type: tracking.
- Accounts: Checking , Checking , AMEX, Partner (a credit card ).
- Access to the server is through the `@actual-app/api` Node client (version must match the server, now 26.11.0); the Actual UI balance is authoritative.
- Bank sync is SimpleFIN (beta bridge); 90-day request cap.
- Rules cannot be applied retroactively; existing transactions must be updated directly.
- The public API cannot write splits (`updateTransaction` with subtransactions fails). The client's internal `rule-apply-actions` handler can: it applies rule-style actions (`set-split-amount` plus per-split `category`) to existing transactions without creating a rule, and writes real splits. Verified on a local copy (children sum to the parent). It is not a public API, so the client version stays pinned.

## Open data issues
- No uncategorized transactions remain (user categorized the rest on 2026-11-23).
- The two May splits on Checking (Spectrum 5/18, Old Apartment 5/4) are the user's own budget-balancing edits; leave them alone. The app's split-sum checks should ignore or tolerate them.
- Layaway payment plans have schedules (three). Layaway final payments are separate one-time schedules; new one-offs keep appearing. Some schedule next-dates may be stale.
- No paycheck schedule: Primary's pay can include bonuses and Partner is a contractor with varying pay. The forecast shows the balance without income until a pattern is known (base amounts above can be used as a conservative estimate).
- Gym category kept: all Planet Fitness charges (May-Nov), the keyword rules and the Gym Membership schedule already point to it.
- Shopping is the catch-all and is deeply overspent; Target purchases currently go to Shopping (the auto-split rule for new Target charges remains).
- Income deposits use the Primary/Partner income categories; small interest and some deposits sit in Savings.

### Resolved
- New Apartment rent schedule added (monthly on the 1st, Checking); July-November payments linked.
- Six stray transfer pairs on Checking removed; real Savings/Checking transfers relinked. Balances unchanged.
- 70 rules now (keyword rules per category); existing uncategorized transactions categorized directly.
- Trip charges and Target put in Shopping; deposits mapped to Shopping (refunds/credits) or Savings (income).

## Operations (not in the app)
- Done: Tugtainer password set, Actual on the floating `latest` tag (26.11.0) with auto-check, built-in bank sync enabled, API client upgraded, host root disk cleaned.
- Backups of the server data are kept locally until the owner is satisfied.
- Optional: Tugtainer notifications.

## Possible later
- Scheduler (e.g. Cronicle) if cron-style scripts are needed.
- Tugtainer notifications.
