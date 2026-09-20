# Deployment

Run the existing Node service or Docker Compose stack. The process builds all active landings at startup; bundled feed, fleet, or configuration changes require a restart. Keep `state/` persistent for feed caches and statistics.

## Existing URL contract

The public deployment uses `/ferryTimesMobile/` for the board, with map and stats links beneath it. Static assets and APIs retain their existing root paths. The proxy must forward the board prefix, `/assets/`, `/api/`, `/app.js`, `/styles.css`, and `/sw.js`. It may strip the board prefix; the Node server also handles prefixed map and stats routes.

Local root deployment uses the same responsive layout. The existing manifest remains scoped to the public prefix; changing install identity is a separate deployment decision.

## Cleanup upgrade

Deploy server and public files together, including all new files beneath `public/assets/`. Asset version 102 replaces the previous shell/data caches. Preferences and per-landing schedules retain their existing browser keys.

No SFTP connections are created. The override endpoint, polling, full-screen notice, and dependency are removed. Existing private keys, `config/sftp.json`, and `state/manual-overrides.json` are not read and are left untouched on deployed systems; remove them through the deployment's normal credential and file-retention process.

Health responses no longer contain `sftpOverride`. Historical statistics may retain old override request counts. Official alerts and crew notices are unaffected.

## Verification after deploy

Check `/healthz`, default and explicit landing data, the board and map, then reopen an existing installed app. Confirm preferences survive the update and cached departures work offline. Confirm the retired override URL returns 404 and the browser makes no requests to it.
