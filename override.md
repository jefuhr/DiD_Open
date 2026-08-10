# Landing Override Integration Guide

This document defines the integration contract for publishing landing-specific notices to the NYC Ferry DiD screens. It applies to Power Automate and any additional interface that updates overrides.

## How the system works

```text
Power Automate or another authorized interface
                    |
                    | writes one JSON file over SFTP
                    v
          Central SFTP /overrides folder
                    ^
                    | outbound, read-only polling
                    |
             Kiosk Node application
                    |
                    | local cached state
                    v
              Kiosk browser screen
```

The kiosk does not accept inbound override requests. The writing interface connects to the central SFTP server. Each kiosk independently connects outbound to SFTP with a read-only key and checks only the file for its configured landing.

The kiosk landing comes from `landingNumber` in [`config/display.json`](./config/display.json). The SFTP connection and polling interval come from [`config/sftp.json`](./config/sftp.json).

## Remote file layout

The remote directory is configured with `remoteDirectory`. Inside that directory there must be one two-digit JSON file for every landing ID from 2 through 26:

```text
<remoteDirectory>/02.json
<remoteDirectory>/03.json
...
<remoteDirectory>/26.json
```

Upload-ready starter files are provided in [`overrides/`](./overrides).

| ID | Landing | File |
|---:|---|---|
| 2 | Astoria | `02.json` |
| 3 | Atlantic Avenue | `03.json` |
| 4 | Bay Ridge | `04.json` |
| 5 | Brooklyn Navy Yard | `05.json` |
| 6 | Corlears Hook | `06.json` |
| 7 | DUMBO | `07.json` |
| 8 | East 34th Street | `08.json` |
| 9 | East 90th St | `09.json` |
| 10 | Ferry Point Park | `10.json` |
| 11 | Governors Island | `11.json` |
| 12 | Greenpoint | `12.json` |
| 13 | Hunters Point South | `13.json` |
| 14 | Long Island City | `14.json` |
| 15 | North Williamsburg | `15.json` |
| 16 | Pier 11 | `16.json` |
| 17 | Red Hook | `17.json` |
| 18 | Rockaway + Bus Stop | `18.json` |
| 19 | Roosevelt Island | `19.json` |
| 20 | Soundview | `20.json` |
| 21 | South Williamsburg | `21.json` |
| 22 | St. George | `22.json` |
| 23 | Stuyvesant Cove | `23.json` |
| 24 | Sunset Park | `24.json` |
| 25 | Battery Park City | `25.json` |
| 26 | Pier 79 | `26.json` |

Landing ID 1 is intentionally unused. IDs 2 through 24 are ordered alphabetically; 25 and 26 were added later and appended so existing kiosk numbering stayed stable.

## JSON contract

Files must contain UTF-8 encoded JSON with this shape:

```json
{
  "landingId": 10,
  "message": "Landing temporarily closed. Please await further instructions.",
  "updatedAt": "2026-08-08T14:30:00Z"
}
```

| Field | Required | Rules |
|---|---|---|
| `landingId` | Yes | Whole number from 2 through 26. It must match the file name and the intended landing. |
| `message` | Yes | String containing 0 through 2,000 characters. Leading and trailing whitespace is removed by the kiosk. An empty or whitespace-only value clears the notice. |
| `updatedAt` | Recommended | A valid ISO 8601 date-time string, normally the UTC time of the write. Use a value such as `new Date().toISOString()` or Power Automate's `utcNow()`. It can be `null` when the message is blank. |

Unknown properties are ignored. `updatedAt` is currently informational; it does not prevent an older write from replacing a newer write.

### Activate a notice

Write a non-empty message to the landing file:

```json
{
  "landingId": 21,
  "message": "Boarding is temporarily suspended. Please remain in the terminal for updates.",
  "updatedAt": "2026-08-08T14:30:00Z"
}
```

### Clear a notice

Overwrite the same file with an empty message:

```json
{
  "landingId": 21,
  "message": "",
  "updatedAt": "2026-08-08T14:35:00Z"
}
```

Do not delete or rename the landing file to clear a notice. A missing, unreadable, or invalid file is treated as an SFTP failure, so the kiosk deliberately retains its last valid cached notice.

## Requirements for a writing interface

An additional interface should perform the following steps:

1. Require the operator to choose a landing ID from 2 through 26.
2. Accept a message of no more than 2,000 characters.
3. Confirm that a blank message means **clear the current notice**.
4. Generate the two-digit file name with `String(landingId).padStart(2, "0") + ".json"`.
5. Construct the JSON object using a JSON serializer. Do not build JSON by directly concatenating unescaped operator text.
6. Set `updatedAt` to the current UTC time.
7. Write the JSON to `<remoteDirectory>/<fileName>` using the interface's SFTP write account.
8. Report success only after the SFTP write or rename completes.
9. Record an operator audit entry outside the override file if the interface needs history. The landing file represents only current state.

Recommended JavaScript object construction:

```js
const landingId = 10;
const notice = {
  landingId,
  message: operatorMessage,
  updatedAt: new Date().toISOString()
};

const fileName = `${String(landingId).padStart(2, "0")}.json`;
const fileContent = `${JSON.stringify(notice, null, 2)}\n`;
```

### Safe writes

If the interface's SFTP library and server support replacement by rename, use this pattern to prevent a kiosk from reading a partially written file:

1. Upload the complete content to a unique temporary file in the same remote directory, such as `10.json.tmp-<unique-id>`.
2. Rename the temporary file to `10.json`, replacing the existing file.

If atomic replacement is unavailable, updating `10.json` directly is supported. A kiosk that catches incomplete JSON will ignore that poll, preserve its cached state, reconnect, and try again during the next polling cycle.

### Multiple writing interfaces

The remote landing file is a last-write-wins record. If Power Automate and another interface can update the same landing concurrently, they must share an authorization and audit policy. The kiosk does not compare `updatedAt` values to resolve conflicts.

If strict conflict prevention is needed, the writing interfaces should coordinate through a shared backend or require the operator to confirm the current remote state before overwriting it.

## What the kiosk does

At startup, Node reads both configuration files and starts the SFTP poller when `enabled` is `true`.

On every poll, the kiosk:

1. Connects to the configured SFTP server with its private key.
2. Verifies the server against the configured SHA256 host-key fingerprint.
3. Downloads only its own landing file.
4. Validates the JSON, landing ID, message type, length, and timestamp.
5. Saves a changed valid notice atomically to `state/manual-overrides.json`.
6. Makes the cached state available to the local kiosk browser.

The Node process maintains its SFTP connection while healthy and reconnects after an error. The browser checks Node's local cached state every five seconds. Therefore, a normal screen change can take up to approximately `pollSeconds + 5` seconds to appear.

When a message is active, the screen hides:

- GTFS route and departure information;
- boat names and arrival estimates;
- the Ferry Mart advertisement; and
- the GTFS service-alert strip.

The screen replaces those regions with the large NYC Ferry service-notice panel. The landing header and clock remain visible.

## Failure and recovery behavior

The kiosk retains the last valid cached state when it encounters:

- an SFTP connection or authentication failure;
- a host-key fingerprint mismatch;
- a missing landing file;
- malformed or incomplete JSON;
- a landing ID that does not match the kiosk file;
- a non-string or over-length message; or
- an invalid non-empty `updatedAt` value.

This behavior prevents a temporary network or writer failure from unexpectedly clearing an important notice. It also means a notice must always be explicitly cleared by writing a valid object with an empty message.

When SFTP is disabled in configuration, cached overrides are not displayed.

## SFTP configuration

Example:

```json
{
  "enabled": true,
  "host": "sftp.example.org",
  "port": 22,
  "username": "nycf-kiosk-readonly",
  "privateKeyPath": "secrets/id_ed25519",
  "privateKeyPassphraseEnv": "",
  "hostKeySha256": "SHA256:verified_server_fingerprint",
  "remoteDirectory": "/overrides",
  "pollSeconds": 10,
  "readyTimeoutSeconds": 15,
  "verboseErrors": true
}
```

`privateKeyPassphraseEnv` should be an empty string when the kiosk private key has no passphrase.

Set `verboseErrors` to `true` to include the underlying error stack in the Node console. Set it to `false` for shorter console logs. Structured error details and repair hints remain available in `/api/health` either way. Private-key contents and passphrases are never added to health output.

The application does not expand `%USERPROFILE%`, `$HOME`, or `~` inside `privateKeyPath`. Use either:

- a path relative to the project, such as `secrets/id_ed25519`; or
- a complete absolute path using forward slashes, such as `C:/Users/Kiosk/.ssh/id_ed25519` on Windows.

In JSON, a Windows backslash must be doubled, so `C:\\Users\\Kiosk\\.ssh\\id_ed25519` is also valid. A single `\n`, `\t`, or similar sequence is interpreted as a control character and will break the path.

Node must be restarted after changing `config/sftp.json` or the landing number. Notice-file changes do not require a restart.

## Security model

- The kiosk account should have read-only access to the override files.
- Power Automate and other writing interfaces should use separate write credentials.
- Keep kiosk private keys out of source control. The project's `secrets/` directory is ignored by Git.
- Pin and verify the SFTP server's SHA256 host-key fingerprint.
- Do not place passwords, private keys, or passphrases inside override JSON files.
- Restrict operator access in the writing interface and retain an external audit history when operational policy requires it.
- The kiosk exposes no writable override HTTP endpoint. Its local `/api/override` route is read-only and exists only for communication between Node and the browser on the kiosk.

## Local diagnostics

From the kiosk itself:

```text
GET http://127.0.0.1:8090/api/health
```

The `sftpOverride` section reports:

- `state`: `disabled`, `idle`, `checking`, `connected`, or `error`;
- the safe SFTP target host, port, and remote landing path;
- the configured and most recently presented server host-key fingerprints, including whether they matched;
- poll and connection timeout settings;
- whether a check is currently running;
- last attempt, success, failure, recovery, change, and next-poll timestamps;
- total attempts and successes;
- consecutive failure count; and
- `currentError` and historical `lastError` objects.

Example failure:

```json
{
  "state": "error",
  "consecutiveFailures": 3,
  "totalAttempts": 12,
  "totalSuccesses": 9,
  "currentError": {
    "at": "2026-08-08T14:30:00.000Z",
    "stage": "private-key",
    "code": "ENOENT",
    "name": "Error",
    "message": "ENOENT: no such file or directory",
    "hint": "The configured privateKeyPath does not exist. Use a project-relative path or a complete absolute path; environment variables and ~ are not expanded."
  }
}
```

Error stages identify the operation that failed:

| Stage | Meaning |
|---|---|
| `private-key` | The configured kiosk private key could not be read. |
| `connect` | DNS, TCP, host verification, SSH negotiation, or authentication failed. |
| `download` | The remote landing file could not be found or read. |
| `validate` | The downloaded file did not satisfy the JSON contract. |
| `read-cache` | Node could not read the local cached notice. |
| `write-cache` | Node could not save a changed notice locally. |

Each failed poll also writes a structured `[SFTP override]` console entry containing the landing, safe target, remote path, failure count, stage, code, message, and troubleshooting hint. A successful retry writes a recovery entry showing how many polls failed before recovery.

For a host-verification failure, `currentError.hostKeyVerification` includes both `configured` and `presented` fingerprints. Confirm the presented fingerprint through the SFTP administrator or provider before copying it into configuration. The kiosk public/private authentication key fingerprint is different from the SFTP server host-key fingerprint.

The locally cached notice can be inspected with:

```text
GET http://127.0.0.1:8090/api/override?landingId=10
```

This route does not update a notice and is not used by Power Automate or other remote interfaces.

## Integration test checklist

Before putting a new interface into service, verify all of the following:

- A valid non-empty message appears only at the selected landing.
- A blank message restores the normal GTFS screen.
- Landing IDs 1, 25, decimals, text values, and missing IDs are rejected by the interface.
- Messages longer than 2,000 characters are rejected before upload.
- Quotes, apostrophes, line breaks, and non-English characters produce valid JSON and display correctly.
- The generated file name always contains two digits.
- The JSON `landingId` always matches the file name.
- A failed SFTP write is shown as a failure to the operator.
- Concurrent updates follow the intended last-write-wins policy.
- The kiosk recovers automatically after an SFTP interruption.
- The interface never deletes a landing file when clearing a notice.

## Power Automate

The current Power Automate action layout is:

```text
Manually trigger a flow
  landingId: Number
  message: Text
        |
Validate landingId is 2 through 26
        |
Compose two-digit file name
        |
Compose the notice JSON object
        |
SFTP - SSH: Get file metadata using path
        |
SFTP - SSH: Update file
```

Detailed Power Automate setup instructions remain in [`README.md`](./README.md#build-the-power-automate-instant-flow).
