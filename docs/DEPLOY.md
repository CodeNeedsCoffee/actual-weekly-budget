# Deploying Weekly Grind

The bridge runs as a container on the home server and the phone talks to it over the home network. Nothing here is reachable from outside the house.

## 1. The bridge on the server
1. On the server, get `compose.yaml` and `.env.example` from this repo (clone it, or copy the two files).
2. Create `bridge.env` next to `compose.yaml` from `.env.example` and fill it in. Keep the real values in your password manager, never in git:
   - `BRIDGE_TOKEN`: a long random string (this is what the phone sends). Make one with `openssl rand -hex 24`.
   - `ACTUAL_URL`: the address of the Actual server **as the container sees it**. If both run on the same host, use the host's LAN address, not `localhost`.
   - `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_ID`: the Actual server password and the budget's sync id (Settings > Advanced).
   - `SPLIT_RULES_FILE=/config/split-rules.json`, `FORECAST_CONFIG_FILE=/config/forecast-config.json` (optional, see below).
3. Put `split-rules.json` and `forecast-config.json` in a `config/` folder next to the compose file (examples are in `bridge/`). These hold personal estimates (paychecks, bills), so they stay on the server.
4. `docker compose up -d`, then check `curl http://localhost:8787/health`. It should answer `{"ok":true,"apiClientVersion":"..."}` and the container should become `healthy`.

The image comes from `ghcr.io/codeneedscoffee/actual-weekly-budget-bridge`, built by GitHub Actions on every change to `bridge/`. If the first pull is refused, open the package's settings on GitHub and make it public (the image holds no secrets), or `docker login ghcr.io`. To build on the server instead, run `docker compose build`.

### Version match
The Actual client inside the bridge must be the same version as the Actual server (`@actual-app/api` in `bridge/package.json`, now `26.11.0`). When you upgrade the Actual server, change that version, let the workflow publish a new image, and update the bridge. `/health` reports the client version.

### Automatic updates (Tugtainer)
Tugtainer needs no labels: add the host in Tugtainer, find the `weekly-grind-bridge` container, and switch it from "check" to "auto-update" in its UI. Because the bridge only holds a small log, an update is just a pull and restart.

## 2. The app on the phone
1. Build: `cd app && flutter build apk --release` gives `build/app/outputs/flutter-apk/app-release.apk`. Android release builds are signed with the key in `app/android/key.properties` and `app/android/upload-keystore.jks`. Neither is in git. **Back both up in your password manager**: the same key is needed to update the app later without uninstalling it.
2. Copy the APK to the phone (USB with `adb install -r`, or any file transfer) and open it. Allow installs from that source if asked.
3. Open Weekly Grind, enter `http://<server address>:8787` and the token, and confirm with fingerprint or PIN. Give the server a fixed address (a DHCP reservation on the router) so the saved address keeps working.

The bridge speaks plain HTTP on the local network, so the token travels unencrypted inside the house. That is fine for a trusted home network; for use away from home, add Tailscale or a TLS reverse proxy first.

## 3. Starting from what you already did by hand
Extra income that was already spent by hand must be recorded once, or the Month end tab will offer to spend it again. For each month, send the amount in cents:
```
curl -X POST http://<server>:8787/balancing/record \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"month":"2026-06","amount":35151}'
```
Check the result on the Month end tab: "Extra income to spend" should not include money you have already applied.

## 4. Backup and restore
- **Irreplaceable:** `bridge.env` (secrets: keep in the password manager), the `config/` folder, and the `balancing-log.json` file in the bridge's data volume (it records which extra income has been used and lets you undo changes). Everything else in the volume is the Actual client's local copy of the budget, which is re-downloaded on start.
- **Actual itself** is backed up the way you already back up the Actual server; the bridge never stores the budget.
- **Backup the data volume:**
  `docker run --rm -v <project>_bridge-data:/data -v "$PWD":/b busybox tar czf /b/bridge-data.tgz -C /data .`
  (`<project>` is the compose folder name; `docker volume ls` shows it.)
- **Restore:**
  `docker compose stop bridge`, then
  `docker run --rm -v <project>_bridge-data:/data -v "$PWD":/b busybox sh -c "cd /data && tar xzf /b/bridge-data.tgz && chown -R 1000:1000 /data"`,
  then `docker compose start bridge`.
- If the log is lost, it can be rebuilt with the `/balancing/record` calls above, so nothing is stuck.

## 5. Moving the bridge to another machine (such as the Zima Blade)
1. On the old host: `docker compose stop`, take the data backup above, and copy `compose.yaml`, `bridge.env` and `config/`.
2. On the new host: put the files in one folder, restore the data volume, and `docker compose up -d`. The image is x86-64, which is what the Zima Blade runs.
3. Update `ACTUAL_URL` in `bridge.env` if the Actual server's address changed, and give the new host the old host's fixed address (or change it in the app under Settings > Change bridge or token).
4. Remove the old container and re-add the new one in Tugtainer.
