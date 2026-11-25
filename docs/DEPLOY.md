# Deploying Weekly Grind

The bridge runs as a container on the home server next to a Cloudflare tunnel (`cloudflared`). The phone reaches it over **https** through Cloudflare, from anywhere. The bridge publishes no port of its own, so nothing reaches it except through the tunnel.

## 1. Cloudflare (once)
1. In Cloudflare Zero Trust, go to Networks > Tunnels, create a tunnel and copy its token.
2. Add a public hostname to the tunnel (for example `grind.<your domain>`) with the service set to `http://bridge:8787` (the bridge container, on the compose network).
3. **Protect the hostname with Cloudflare Access** (strongly recommended, it is a second lock in front of the token): Access > Applications > Self-hosted, for that hostname, add a policy with action **Service Auth** that allows one new **service token**. Copy the token's Client ID and Secret. The app sends them with every request (Connect screen > Cloudflare Access).
4. Optionally add a WAF rate-limiting rule for the hostname (for example 100 requests per minute per IP).

## 2. The bridge on the server
1. On the server, get `compose.yaml` and `.env.example` from this repo (clone it, or copy the two files).
2. Create `bridge.env` next to `compose.yaml` from `.env.example` and fill it in. Keep the real values in your password manager, never in git. Use `chmod 600 bridge.env cloudflared.env`.
   - `BRIDGE_TOKEN`: at least 32 random characters, `openssl rand -hex 24`. The bridge refuses to start with a shorter one.
   - `ACTUAL_URL`: the Actual server's address **as the container sees it** (its LAN address, not `localhost`).
   - `ACTUAL_PASSWORD`, `ACTUAL_BUDGET_ID`: the Actual server password and the budget's sync id (Settings > Advanced).
   - `SPLIT_RULES_FILE=/config/split-rules.json`, `FORECAST_CONFIG_FILE=/config/forecast-config.json` (optional).
3. Create `cloudflared.env` containing `TUNNEL_TOKEN=<the tunnel token>`.
4. Put `split-rules.json` and `forecast-config.json` in a `config/` folder next to the compose file (examples in `bridge/`). They hold personal estimates, so they stay on the server.
5. `docker compose up -d`. Check `docker compose ps` (the bridge should become `healthy`, the tunnel `running`) and, from any machine, `curl https://<your hostname>/health`. With the Access policy on you will be turned away, which is correct; test through the app.

The image comes from `ghcr.io/codeneedscoffee/actual-weekly-budget-bridge`, built by GitHub Actions on every change to `bridge/`. If the first pull is refused, make the package public in GitHub's package settings (the image holds no secrets), or `docker login ghcr.io`. To build on the server instead, run `docker compose build`.

### Version match
The Actual client inside the bridge must be the same version as the Actual server (`@actual-app/api` in `bridge/package.json`, now `26.11.0`). When you upgrade the Actual server, change that version, let the workflow publish a new image, and update the bridge.

### Automatic updates (Tugtainer)
Tugtainer needs no labels: add the host in Tugtainer and switch `weekly-grind-bridge` (and the tunnel) from "check" to "auto-update" in its UI.

## 2b. The app on the phone
1. Build: `cd app && flutter build apk --release` gives `build/app/outputs/flutter-apk/app-release.apk`. It is signed with the key in `app/android/key.properties` and `app/android/upload-keystore.jks` (not in git). **Back both up in your password manager**: the same key is needed to update the app later without uninstalling it.
2. Copy the APK to the phone (`adb install -r`, or any file transfer) and open it.
3. Open Weekly Grind and enter `https://<your hostname>`, the bridge token, and (under Cloudflare Access) the service token's ID and secret. Confirm with fingerprint or PIN.

The release app only accepts `https://` addresses: the connection carries the whole budget, so the app refuses plain http, does not follow redirects, and Android itself blocks cleartext traffic in release builds. (Debug builds allow http so the emulator can use a local test bridge.)

## 2c. Security notes
- **Layers:** Cloudflare (TLS, optional WAF) > Cloudflare Access service token > the bridge token (constant-time compared, 32+ characters) > a per-client lockout after 10 wrong tokens (15 minutes) and a request-rate cap.
- **What an unauthenticated caller sees:** `/health` says only that it is up. Every other path, including ones that do not exist, answers `401`. Errors never include details. Every response carries `Cache-Control: no-store` and strict headers.
- **The container:** non-root, read-only filesystem (only the data volume and `/tmp` are writable), all Linux capabilities dropped, no-new-privileges, memory and process limits, and no published port.
- **The phone:** the login and the offline copy are encrypted behind biometrics or the device PIN (see `docs/DEV.md`).
- **If the token leaks:** change `BRIDGE_TOKEN` in `bridge.env`, `docker compose up -d`, and enter the new token in the app (Settings > Change bridge or token). Rotate the Access service token the same way in Cloudflare. Every change the bridge makes can be undone from the Month end tab.
- **Still your call:** Cloudflare can see traffic that passes through its tunnel (it terminates TLS). The bridge only holds budget amounts and category names, never bank credentials.

## 3. Starting from what you already did by hand
Extra income that was already spent by hand must be recorded once, or the Month end tab will offer to spend it again. For each month, send the amount in cents:
```
curl -X POST https://<your hostname>/balancing/record \
  -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" \
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
  `docker compose stop bridge cloudflared`, then
  `docker run --rm -v <project>_bridge-data:/data -v "$PWD":/b busybox sh -c "cd /data && tar xzf /b/bridge-data.tgz && chown -R 1000:1000 /data"`,
  then `docker compose start bridge cloudflared`.
- If the log is lost, it can be rebuilt with the `/balancing/record` calls above, so nothing is stuck.

## 5. Moving the bridge to another machine (such as the Zima Blade)
1. On the old host: `docker compose stop`, take the data backup above, and copy `compose.yaml`, `bridge.env`, `cloudflared.env` and `config/`.
2. On the new host: put the files in one folder, restore the data volume, and `docker compose up -d`. The image is x86-64, which is what the Zima Blade runs.
3. Update `ACTUAL_URL` in `bridge.env` if the Actual server's address changed. The phone does not need to change: the public hostname stays the same, because the tunnel connects out from whichever machine runs it. Stop the old tunnel first so only one runs.
4. Remove the old containers and add the new ones in Tugtainer.
