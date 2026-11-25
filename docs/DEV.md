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

## Savings sweep
Moves free budget into the Savings category. "Free" is spare balance left after every overspent category has been covered (the rebalance comes first), so the two never compete. Protected categories are never touched, no budget goes below zero, and Savings is never a donor.
- `GET /sweep/proposal?month=&amount=` previews (defaults to the month that just ended and all free money; `amount` in cents is capped at what is free). It includes a cash check: the 14-day forecast low without income, minus the amount, against the buffer.
- `POST /sweep/apply { id, month, amount? }` writes it (id must match the preview). It is logged, and `POST /balancing/revert` undoes it.
- Budgets are plans, not cash. The cash check warns when moving that much real money to the Savings account could leave Checking under the buffer.

## Recovery tracker
`GET /recovery?from=` (defaults to `balancingFrom`) returns, per month from `from` to the current month, the running overspend, the extra income received and the amount applied, plus totals: `poolRemaining` (extra income not yet used), `overspentNow`, and `leftToRecover` (what is still overspent after the unused extra income is counted). The current month's extra income is not counted until the month ends. The Month end tab shows it as the top card.

## App behaviour
- The app opens straight into the tabs when a bridge address and token are saved (Settings > Change bridge or token clears them).
- Reads are saved on the phone. When the bridge cannot be reached the last saved answer is shown with an "Offline" banner; writes (apply, sync, categorize) always need the bridge. The saved copy is cleared when the connection is changed.
- Settings (Accounts tab, gear icon): theme (system, light, dark).

## App lock and encryption
- The app is locked until the device owner unlocks it with biometrics or, when biometrics are not available or fail, the device PIN/passcode. It locks again after 30 seconds in the background, and while it is in the background the screen shows a cover instead of the budget (so the app switcher shows nothing).
- The saved bridge address and token live in a hardware-backed keystore entry that needs that unlock for every read. On Android it is a keystore AES key (API 28+, so the minimum is set to 28); on iOS a keychain item with `userPresence` access control, only while a passcode is set, never backed up or synced.
- The same entry holds a random 256-bit key. The offline copy of the bridge's answers is encrypted with AES-256-GCM under that key, and its entry names are hashed, so the files on the phone show neither the data nor the address. Changing the bridge in Settings wipes the login and the saved copy.
- If the phone's biometrics change (a new fingerprint is added) or the passcode is removed, the keystore key is invalidated: the app asks for the bridge address and token again. Nothing is lost on the bridge side.
- Versions before the lock stored the login unprotected; the first unlock moves it into the vault and removes the old copy.
- iOS: the project is generated with `flutter create --platforms=ios`, with Face ID and local-network usage text and plain-HTTP allowed on the local network. It cannot be built on Linux; it needs `flutter build ios` on a Mac (with an Apple developer account for a device build). It has not been run yet.
