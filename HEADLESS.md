# Headless Dev Mode

Run the MindStudio dev tunnel without a terminal UI. Headless mode outputs structured JSON events to stdout, designed for programmatic control by a parent process — a sandbox controller, CI pipeline, or any automation that needs to run the dev tunnel as a background service.

**The tunnel does NOT start a dev server.** You manage the dev server (Vite, webpack, etc.) separately. The `--port` flag tells the tunnel which port to proxy to.

---

## Quick Start

```bash
cd /path/to/your-app    # must contain mindstudio.json with "appId"
mindstudio-local --headless --port 5173
```

The tunnel reads `mindstudio.json`, starts a platform session, syncs table schemas, starts the local proxy, and enters the poll loop. JSON events stream to stdout. The process runs until killed (`SIGTERM`/`SIGINT`) or the session expires.

---

## CLI Flags

```
mindstudio-local --headless [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--headless` | — | Required. Run without TUI, output JSON to stdout. |
| `--port <n>` | from `web.json` | Dev server port to proxy to. If omitted, reads `devPort` from the web interface config. If neither exists, proxy is skipped (backend-only). |
| `--proxy-port <n>` | auto (3100-3999) | Preferred port for the local proxy. Falls back to OS-assigned if taken. |
| `--bind <addr>` | `127.0.0.1` | Bind address for the proxy. Use `0.0.0.0` in hosted sandboxes where the proxy needs to be accessible externally. |

---

## Startup Sequence

1. Read `mindstudio.json`, validate config and `appId`
2. Emit `session-starting`
3. Start platform session (registers methods, gets session token and client context)
4. Sync table schema if tables are declared → emit `schema-sync-completed`
5. Start local proxy if `devPort` is set (injects `window.__MINDSTUDIO__` into HTML)
6. Emit `session-started` with full session info including roles and scenarios
7. Begin polling the platform for method execution requests
8. Set up file watchers on `mindstudio.json` and table file directories

---

## JSON Event Protocol

Every line written to stdout is a JSON object with an `event` field. Events are newline-delimited (one JSON object per line).

### Session Lifecycle

**`session-starting`** — Session is initializing.
```json
{"event":"session-starting","appId":"e452fcf2-...","name":"Procure-to-Pay"}
```

**`session-started`** — Platform session is active, proxy is running, the tunnel is polling for work.
```json
{
  "event": "session-started",
  "sessionId": "848583c4-...",
  "releaseId": "848583c4-...",
  "branch": "main",
  "proxyPort": 3835,
  "proxyUrl": "http://localhost:3835/",
  "webInterfaceUrl": "https://848583c4.static.mscdn.ai/?__ms_token=...",
  "roles": [
    {"id": "ap", "name": "Accounts Payable", "description": "Can approve invoices"}
  ],
  "scenarios": [
    {"id": "sc-1", "name": "seedData", "description": "...", "path": "src/scenarios/seed.ts", "roles": ["ap"]}
  ]
}
```

`proxyPort` and `proxyUrl` are `null` if no dev server port was configured (backend-only mode). Scenario `name` falls back to the export name if no display name is set. Role `name` falls back to the role id.

**`session-stopping`** — Graceful shutdown initiated (`SIGTERM`/`SIGINT` received).
```json
{"event":"session-stopping"}
```

**`session-stopped`** — All resources cleaned up. The process will exit.
```json
{"event":"session-stopped"}
```

**`session-expired`** — The platform expired the dev session (404 on poll). The process will exit with code 1.
```json
{"event":"session-expired"}
```

### Method Execution

Methods are executed automatically when the platform sends a request via the poll loop. No stdin command is needed.

**`method-started`** — A method execution request was received from the platform.
```json
{"event":"method-started","id":"req-uuid-1","method":"getDashboard"}
```

**`method-completed`** — Method execution finished.
```json
{"event":"method-completed","id":"req-uuid-1","success":true,"duration":45}
```

On failure:
```json
{"event":"method-completed","id":"req-uuid-1","success":false,"duration":120,"error":"[db] query failed: ..."}
```

### Scenario Execution

Triggered by the `run-scenario` stdin command.

**`scenario-started`** — A scenario is being applied (truncate + seed + impersonate).
```json
{"event":"scenario-started","id":"sc-1","name":"seedApproverData"}
```

**`scenario-completed`** — Scenario finished.
```json
{"event":"scenario-completed","id":"sc-1","success":true,"duration":1830,"roles":["approver"]}
```

On failure:
```json
{"event":"scenario-completed","id":"sc-1","success":false,"duration":450,"roles":["approver"],"error":"Insert failed"}
```

### Schema Sync

Schema is synced automatically on startup and whenever a table source file changes on disk. No stdin command is needed.

**`schema-sync-started`** — A table file change was detected and schema sync is beginning.
```json
{"event":"schema-sync-started"}
```

**`schema-sync-completed`** — Schema sync finished. Check `errors` array for any issues.
```json
{"event":"schema-sync-completed","created":["vendors","purchase_orders"],"altered":[],"errors":[]}
```

Also emitted on startup (without a preceding `schema-sync-started`).

### Impersonation

**`impersonation-changed`** — Role override was set or cleared (via `impersonate`/`clear-impersonation` commands, or as part of a scenario).
```json
{"event":"impersonation-changed","roles":["approver"]}
```

When cleared, `roles` is `null`.

### Connection

**`connection-lost`** — Lost connection to the platform. The tunnel will retry with exponential backoff.
```json
{"event":"connection-lost","message":"Lost connection to platform, retrying..."}
```

**`connection-restored`** — Reconnected after a connection loss.
```json
{"event":"connection-restored"}
```

### Config Changes

**`config-changed`** — `mindstudio.json` was modified. The session will be torn down and restarted automatically. A new `session-starting` → `session-started` sequence will follow.
```json
{"event":"config-changed"}
```

### Errors

**`error`** — Fatal startup error. The process may exit.
```json
{"event":"error","message":"No valid mindstudio.json found in /workspace"}
```

**`config-error`** — Non-fatal config or session startup error. Emitted when `mindstudio.json` is invalid or the session fails to start during a restart. The file watcher remains active — fix the config and save to trigger another attempt.
```json
{"event":"config-error","message":"Missing \"appId\" in mindstudio.json"}
```

**`command-error`** — A stdin command failed. Non-fatal — the session continues.
```json
{"event":"command-error","message":"No active session"}
```

---

## Stdin Commands

The parent process can send newline-delimited JSON commands to stdin. Each command is a JSON object with an `action` field.

### `run-scenario`

Run a scenario by ID. Truncates all tables, executes the seed function, and impersonates the scenario's roles.

```json
{"action":"run-scenario","scenarioId":"sample-haikus"}
```

Emits: `scenario-started` → `schema-sync-completed` → `impersonation-changed` → `scenario-completed`

### `impersonate`

Set a role override. Subsequent method executions will use these roles instead of the session's default. Also refreshes the client context token so the browser picks up the new roles on next page load.

```json
{"action":"impersonate","roles":["ap","admin"]}
```

Emits: `impersonation-changed`

### `clear-impersonation`

Clear the role override. Reverts to the session's default roles.

```json
{"action":"clear-impersonation"}
```

Emits: `impersonation-changed` with `roles: null`

---

## File Watchers

Headless mode automatically watches for file changes. No polling or stdin commands needed.

| What | Trigger | Action |
|------|---------|--------|
| `mindstudio.json` | Any change (500ms debounce) | Full session teardown and restart. Picks up new methods, scenarios, roles, tables. Emits `config-changed` → `session-starting` → `session-started`. |
| Table source directories | File matching a declared table path created or changed (500ms debounce) | Re-read all table sources and sync schema. No session restart. Emits `schema-sync-started` → `schema-sync-completed`. |

Table directories are deduplicated — if all tables live in `src/tables/`, only one directory watcher is created. Directories are watched (not individual files) so that newly created table files are detected even if they didn't exist when the session started.

---

## Signals

| Signal | Effect |
|--------|--------|
| `SIGTERM` | Graceful shutdown: `session-stopping` → teardown → `session-stopped` → exit 0 |
| `SIGINT` | Same as `SIGTERM` |

If the session expires (platform returns 404 on poll), the tunnel emits `session-expired` and exits with code 1.

---

## Example Session

```
→ (tunnel starts, emits events automatically)
← {"event":"session-starting","appId":"7c4d99f7-...","name":"Haiku Generator"}
← {"event":"schema-sync-completed","created":["haikus"],"altered":[],"errors":[]}
← {"event":"session-started","sessionId":"...","proxyPort":3142,"roles":[...],"scenarios":[...]}

→ {"action":"run-scenario","scenarioId":"sample-haikus"}
← {"event":"scenario-started","id":"sample-haikus","name":"Sample Haikus"}
← {"event":"impersonation-changed","roles":[]}
← {"event":"scenario-completed","id":"sample-haikus","success":true,"duration":234,"roles":[]}

→ {"action":"impersonate","roles":["ap"]}
← {"event":"impersonation-changed","roles":["ap"]}

← {"event":"method-started","id":"req-1","method":"getDashboard"}
← {"event":"method-completed","id":"req-1","success":true,"duration":45}

→ {"action":"clear-impersonation"}
← {"event":"impersonation-changed","roles":null}

(user edits src/tables/vendors.ts)
← {"event":"schema-sync-started"}
← {"event":"schema-sync-completed","created":[],"altered":["vendors"],"errors":[]}

(user edits mindstudio.json)
← {"event":"config-changed"}
← {"event":"session-starting","appId":"7c4d99f7-...","name":"Haiku Generator"}
← {"event":"session-started","sessionId":"...","proxyPort":3142,"roles":[...],"scenarios":[...]}
```

`→` = stdin (parent → tunnel), `←` = stdout (tunnel → parent)

---

## Integration Guide

### Spawning from a parent process (Node.js)

```javascript
import { spawn } from 'child_process';

const tunnel = spawn('mindstudio-local', ['--headless', '--port', '5173', '--bind', '0.0.0.0'], {
  cwd: '/workspace/my-app',
  stdio: ['pipe', 'pipe', 'pipe'],
});

// Read JSON events from stdout
let buffer = '';
tunnel.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim()) {
      const event = JSON.parse(line);
      console.log('Tunnel event:', event);

      if (event.event === 'session-started') {
        console.log('Proxy available at:', event.proxyUrl);
      }
    }
  }
});

// Send a command
tunnel.stdin.write(JSON.stringify({ action: 'run-scenario', scenarioId: 'seed-data' }) + '\n');

// Graceful shutdown
process.on('SIGTERM', () => tunnel.kill('SIGTERM'));
```

### Programmatic API (in-process)

```typescript
import { startHeadless } from '@mindstudio-ai/local-model-tunnel';

// This blocks until shutdown (SIGTERM/SIGINT)
await startHeadless({
  cwd: '/workspace/my-app',
  devPort: 5173,
  bindAddress: '0.0.0.0',
  proxyPort: 3835,
});
```

When using the programmatic API, JSON events are still written to `process.stdout`.

---

## What the parent process is responsible for

- Starting and managing the dev server (Vite, Next.js, etc.)
- Sending `run-scenario` / `impersonate` / `clear-impersonation` commands when the user requests them
- Reading `mindstudio.json` directly for scenario and role lists (these are static config, not runtime state)
- Displaying events to the user (logs, status indicators, etc.)

---

## Proxy Configuration

The local proxy sits in front of the dev server and injects `window.__MINDSTUDIO__` into HTML responses. All other requests (JS, CSS, images, WebSocket upgrades for HMR) are forwarded unchanged.

**Local development (default):**
```bash
mindstudio-local --headless --port 5173
# Proxy binds to 127.0.0.1:{auto-port}
```

**Hosted sandbox:**
```bash
mindstudio-local --headless --port 5173 --bind 0.0.0.0 --proxy-port 3835
# Proxy binds to 0.0.0.0:3835, accessible externally
```

The proxy port is reported in the `session-started` event. If no `--port` is provided and no `devPort` is found in `web.json`, the proxy is not started (backend-only mode — only method execution works, no frontend).
