# Local development

Everything runs locally against a throwaway copy of a budget; no real server or credentials needed.

1. **Local Actual server:** `npm i @actual-app/sync-server@26.11.0` in a scratch folder, run `npx actual-server` with `ACTUAL_DATA_DIR`, `ACTUAL_PORT=5006`, `ACTUAL_HOSTNAME=127.0.0.1`. Set a dev password once with `POST /account/bootstrap`.
2. **Load a budget copy:** with `@actual-app/api`, `exportBudget()` from a local budget folder to a zip, then `importBudget(zip)` against the local server. Keep the zip and data folders outside this repo (the `.gitignore` also blocks them).
3. **Bridge:** from `bridge/`, set `BRIDGE_TOKEN`, `ACTUAL_URL`, `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_ID` (see `.env.example`) and run `npm start`. Tests: `npm test`.
4. **App on the emulator:** `flutter build apk --debug`, install with `adb install -r`. In the app use the emulator's host-loopback alias (see the Android emulator networking docs) with the bridge port, and the bridge token.
5. **Headless emulator notes:** `-no-window -gpu swangle_indirect` boots; start the app with `adb shell am start -n dev.weeklybudget.weekly_budget/.MainActivity --ez enable-software-rendering true --ez enable-impeller false` or the emulator crashes when Flutter renders. Stop the Gradle daemon (`android/gradlew --stop`) after building to free RAM.
6. **Release builds:** plain-HTTP bridge addresses need a network security config before a release APK (M8).

## Forecast and payoff configuration
Set `FORECAST_CONFIG_FILE` to a JSON file (kept out of git; see `bridge/forecast-config.example.json`):
- `checking`, `savings`, `payoffCard`: case-insensitive substrings of the account names.
- `buffer` (cents), `variablePerDay` (everyday spending paid from Checking), `incomeLateDays` (default 7).
- `items`: estimates for things Actual has no schedule for (paychecks, unscheduled bills): `{ name, amount (cents, + income / - bill), dayOfMonth: [..] }`.

How it works: the 14-day forecast uses worst-case amounts for "approximately" and "between" schedules, and shows the low point with and without income. Card schedules are listed separately, since they hit Checking only when the card is paid. The payoff advisor uses the stated amounts, looks 21 days ahead, and reports `safeNow` (survives a paycheck up to `incomeLateDays` late) and `safeTotal` (if income arrives on time).

## Month-end helper (extra-income pool)
Config keys (same file as the forecast): `balancingFrom` (first month, `YYYY-MM`), optional `baseIncome` (`{ "<income category>": cents }`, overrides the budgeted income base), `excludeIncome` (income categories to ignore, default `starting balances`).

- `GET /balancing/proposal` previews the plan (per-month extra, where it goes, overspend after); nothing is written.
- `POST /balancing/apply { id, from, to }` writes it. The id must match the preview, so a changed plan is refused (409).
- Applied amounts are logged in the bridge data directory (`balancing-log.json`), so the same extra income is never spent twice. `POST /balancing/record { month, amount }` marks extra income already spent outside the app.
- `POST /balancing/revert { id }` restores the previous amounts. A budget changed since is left alone and reported.

## Zero-sum rebalance
Moves budget from categories with spare balance into overspent ones, biggest deficit first. Config keys: `protect` (category names it never takes from, such as rent or bills due soon) and `savingsCategory` (default `Savings`).
- `GET /rebalance/proposal?from=&to=&includeSavings=0|1` previews; by default it covers only the month that just ended, because a positive balance in the current month may be a bill that has not hit yet.
- `POST /rebalance/apply { id, from, to, includeSavings }` writes it (id must match the preview). It is logged, and `POST /balancing/revert` undoes it.
- Rules: budgets never go below zero (only Savings may, and only when `includeSavings` is on, after every other donor); a donor is limited so it is not overspent in a later month through carryover; overspent categories are never donors.
- The bridge pulls changes from the server before reads (at most every few seconds), so edits made in the Actual app are picked up.
