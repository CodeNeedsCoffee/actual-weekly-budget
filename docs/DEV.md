# Local development

Everything runs locally against a throwaway copy of a budget; no real server or credentials needed.

1. **Local Actual server:** `npm i @actual-app/sync-server@26.11.0` in a scratch folder, run `npx actual-server` with `ACTUAL_DATA_DIR`, `ACTUAL_PORT=5006`, `ACTUAL_HOSTNAME=127.0.0.1`. Set a dev password once with `POST /account/bootstrap`.
2. **Load a budget copy:** with `@actual-app/api`, `exportBudget()` from a local budget folder to a zip, then `importBudget(zip)` against the local server. Keep the zip and data folders outside this repo (the `.gitignore` also blocks them).
3. **Bridge:** from `bridge/`, set `BRIDGE_TOKEN`, `ACTUAL_URL`, `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_ID` (see `.env.example`) and run `npm start`. Tests: `npm test`.
4. **App on the emulator:** `flutter build apk --debug`, install with `adb install -r`. In the app use the emulator's host-loopback alias (see the Android emulator networking docs) with the bridge port, and the bridge token.
5. **Headless emulator notes:** `-no-window -gpu swangle_indirect` boots; start the app with `adb shell am start -n dev.weeklybudget.weekly_budget/.MainActivity --ez enable-software-rendering true --ez enable-impeller false` or the emulator crashes when Flutter renders. Stop the Gradle daemon (`android/gradlew --stop`) after building to free RAM.
6. **Release builds:** plain-HTTP bridge addresses need a network security config before a release APK (M8).
