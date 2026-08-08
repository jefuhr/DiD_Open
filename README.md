# NYC Ferry DiD Reborn

An offline-first, landscape `16:9` departure display for NYC Ferry landings. It runs from a local Node server, calculates scheduled departures from the bundled GTFS feed, overlays NYC Ferry GTFS-Realtime trip updates, and keeps working when internet service is interrupted.

The Ferry Mart artwork is stored locally at [`public/assets/ad.jpg`](./public/assets/ad.jpg) and is included in the offline application cache.

## Choose the landing

Edit the single number in [`config/display.json`](./config/display.json):

```json
{
  "landingNumber": 16,
  "slideSeconds": 12,
  "departureWindowMinutes": 180,
  "departuresShown": 4,
  "routesShown": 4
}
```

Use a number from `2` through `24`. Number `1` is intentionally unused. The landing names and GTFS stop mappings live in [`config/landings.json`](./config/landings.json). Rockaway (`18`) includes the ferry landing and the connected shuttle-bus stop.

`slideSeconds` controls how long each set of route directions remains on screen. It accepts values from `3` through `300` seconds.

`departureWindowMinutes` controls whether a route-direction group appears. Its next departure must be within that many minutes. Once the group qualifies, the board displays the configured number of remaining departures even when later departures fall outside the window. The default `180` means three hours; accepted values are `1` through `1440`.

`departuresShown` controls how many departure columns appear in each route row. `routesShown` controls how many route-and-destination rows appear on each slideshow page. Both settings accept whole numbers from `1` through `5`; they can be set independently.

The board automatically advances until every direction has been shown. Each group contains its configured number of departure times and the assigned boat name when that assignment is available from the live feed.

After changing the number, restart the app. The `prestart` script rebuilds the local display data automatically.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
npm start
```

Open `http://127.0.0.1:8090`. The device can launch Chromium at that address in kiosk mode. The server binds only to loopback unless `HOST=0.0.0.0` is set explicitly.

Run validation with:

```bash
npm test
npm run build
```

## SFTP landing notices

For the complete file contract and instructions for integrating another writing interface, see [`override.md`](./override.md).

Power Automate does not call the kiosk. Instead, it updates a small JSON file on the existing SFTP server. Each kiosk makes an outbound, read-only SFTP connection and checks only the file matching the `landingNumber` in `config/display.json`. Landing 2 reads `/overrides/02.json`, landing 10 reads `/overrides/10.json`, and so on.

An active notice hides the departure board, Ferry Mart advertisement, and GTFS service-alert strip, replacing them with a large NYC Ferry service-notice panel. A blank message restores the normal display. The last valid SFTP result is kept locally, so a temporary SFTP outage does not unexpectedly change the screen.

### Prepare the SFTP server

1. Create `/overrides` on the SFTP server.
2. Upload all 23 starter files from [`overrides/`](./overrides). They cover landing IDs 2 through 24 and start with blank messages.
3. Give the Power Automate SFTP account permission to update those files.
4. Give the kiosk SFTP account read-only permission. Do not give kiosk devices write access.
5. Record the server's SHA256 host-key fingerprint. On a trusted administrator machine, it can be displayed with `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf - -E sha256`. Confirm it through the server administrator before using it.

Configure [`config/sftp.json`](./config/sftp.json) on each kiosk:

```json
{
  "enabled": true,
  "host": "sftp.example.org",
  "port": 22,
  "username": "nycf-kiosk-readonly",
  "privateKeyPath": "secrets/id_ed25519",
  "privateKeyPassphraseEnv": "NYCF_SFTP_KEY_PASSPHRASE",
  "hostKeySha256": "SHA256:paste_the_verified_server_fingerprint_here",
  "remoteDirectory": "/overrides",
  "pollSeconds": 10,
  "readyTimeoutSeconds": 15,
  "verboseErrors": true
}
```

- `enabled` turns SFTP notice checks on or off.
- `privateKeyPath` can be absolute or relative to the project folder. Private keys belong in the ignored `secrets/` folder and must never be committed or copied into the Docker image.
- `privateKeyPassphraseEnv` names the environment variable containing the key passphrase. Leave the variable unset when the key has no passphrase.
- `hostKeySha256` pins the SFTP server identity and is required when SFTP is enabled.
- `pollSeconds` accepts 5 through 300 seconds. This controls how quickly a kiosk sees an update.
- `readyTimeoutSeconds` accepts 1 through 60 seconds.
- `verboseErrors` includes the underlying error stack in the Node console. The local health response always contains structured, credential-safe diagnostics.

Restart Node after changing SFTP configuration. The notice itself updates without a restart.

### Build the Power Automate instant flow

1. Create an **Instant cloud flow** using **Manually trigger a flow**.
2. Add a **Number** input named `landingId` and a **Text** input named `message`.
3. Add a condition that allows only landing IDs from 2 through 24. Terminate the flow as failed when the value is outside that range.
4. Add a **Compose** action named `File name`. Use `formatNumber(int(<landingId dynamic value>), '00')`, then append `.json`. Landing 2 must produce `02.json`.
5. Add another **Compose** action named `Notice`. Build an object with these three properties, inserting the trigger's dynamic values:

   ```json
   {
     "landingId": 10,
     "message": "Landing temporarily closed.",
     "updatedAt": "2026-08-06T14:30:00Z"
   }
   ```

   Set `updatedAt` with the `utcNow()` expression. Power Automate should supply the number and message dynamically; the values above are only an example.

6. Add **SFTP - SSH: Get file metadata using path**. Set the path to `/overrides/` followed by the `File name` output.
7. Add **SFTP - SSH: Update file**. Use the file ID returned by the metadata action and use `string(outputs('Notice'))` as the file content.
8. Save and test with a valid landing ID. The matching kiosk should update within `pollSeconds`.

To clear a notice, run the same flow with an empty `message`. Do not delete the landing file. The flow should overwrite it with a valid object whose message is blank:

```json
{
  "landingId": 10,
  "message": "",
  "updatedAt": "2026-08-06T14:35:00Z"
}
```

The application accepts messages up to 2,000 characters. A malformed file, mismatched landing ID, failed host-key check, or unavailable SFTP server is ignored and the last locally cached state remains on screen.

## Local resilience

- The complete schedule, landing map, fonts, logo, display code, and advertisement live on the device.
- The last successful realtime trip-update response is written atomically to `state/realtime.json`.
- Live vehicle assignments are matched to the local vessel roster so the display can show boat names beside departure times.
- The bottom strip uses the live NYC Ferry GTFS-Realtime alert feed and saves the last successful alert snapshot to `state/service-alerts.json`.
- The last valid SFTP notice is stored atomically in `state/manual-overrides.json` and survives server restarts.
- The service worker caches the screen shell, advertisement, and API responses.
- The browser keeps a final schedule and realtime snapshot in local storage.
- If NYC Ferry realtime is unavailable, the display continues using the saved live snapshot and then the local scheduled times.

Replace the files in [`gtfs/`](./gtfs) when a new published schedule is issued, then restart the app. The display shows schedule data only from the bundled feed, so deployments remain reproducible and do not depend on downloading GTFS at boot.

## Docker

```bash
docker compose up --build -d
```

The compose service restarts automatically and stores realtime snapshots in the local `./state` directory. If SFTP is enabled, mount the private key read-only into the path configured in `config/sftp.json`; for the sample relative path, add this second volume:

```yaml
volumes:
  - ./state:/app/state
  - ./secrets/id_ed25519:/app/secrets/id_ed25519:ro
```

If the key is encrypted, provide `NYCF_SFTP_KEY_PASSPHRASE` to the container through the deployment's secret-management mechanism.
