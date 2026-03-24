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

There are two types of stdout messages:

- **System events** — unsolicited, no `requestId`. Things that happen automatically (session lifecycle, connection health, platform-triggered methods).
- **Command responses** — always have `requestId` and `status`. Responses to stdin commands.

The caller distinguishes them by the presence of `requestId`.

### System Events

#### Session Lifecycle

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

`proxyPort` and `proxyUrl` are `null` if no dev server port was configured (backend-only mode).

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

#### Platform Method Execution

Methods triggered by the platform (via poll loop). These are NOT responses to stdin commands.

**`platform-method-started`** — A method execution request was received from the platform.
```json
{"event":"platform-method-started","id":"req-uuid-1","method":"getDashboard"}
```

**`platform-method-completed`** — Method execution finished.
```json
{"event":"platform-method-completed","id":"req-uuid-1","success":true,"duration":45}
```

#### Schema Sync

Schema is synced automatically on startup and whenever a table source file changes on disk.

**`schema-sync-started`** — A table file change was detected and schema sync is beginning.
```json
{"event":"schema-sync-started"}
```

**`schema-sync-completed`** — Schema sync finished. Check `errors` array for any issues.
```json
{"event":"schema-sync-completed","created":["vendors","purchase_orders"],"altered":[],"errors":[]}
```

#### Connection

**`connection-lost`** — Lost connection to the platform. The tunnel will retry with exponential backoff.
```json
{"event":"connection-lost","message":"Lost connection to platform, retrying..."}
```

**`connection-restored`** — Reconnected after a connection loss.
```json
{"event":"connection-restored"}
```

#### Auth Refresh

**`auth-refresh-start`** — Session token expired, device auth flow started.
```json
{"event":"auth-refresh-start","url":"https://app.mindstudio.ai/auth/device?token=..."}
```

**`auth-refresh-success`** / **`auth-refresh-failed`** — Auth refresh outcome.

#### Config & Errors

**`config-changed`** — `mindstudio.json` was modified. The session will be torn down and restarted automatically.
```json
{"event":"config-changed"}
```

**`config-error`** — Config or session startup error. The file watcher remains active — fix the config and save to trigger another attempt.
```json
{"event":"config-error","message":"Missing \"appId\" in mindstudio.json"}
```

---

## Stdin Commands

The parent process sends newline-delimited JSON commands to stdin. Every command **must** include a `requestId` for response correlation and an `action` field.

```json
{"requestId": "abc123", "action": "browser-status"}
```

### Command Response Format

Every command receives a response with the same `requestId`, the `action` as the `event`, and a `status` of `"started"` or `"completed"`. Long-running commands may emit `started` before `completed`.

```json
{"event":"browser-status","requestId":"abc123","status":"completed","connected":true}
```

Errors are always in the `completed` response (never separate events):
```json
{"event":"run-method","requestId":"abc123","status":"completed","success":false,"error":"No active session"}
```

Commands without a `requestId` are rejected (logged to stderr, no stdout response). Unknown actions with a valid `requestId` receive a completed response with `success: false`.

### `run-method`

Run a method directly. Looks up by export name (falls back to ID).

```json
{"requestId":"r1","action":"run-method","method":"listHaikus","input":{"topic":"cats"}}
```

Response:
```json
{"event":"run-method","requestId":"r1","status":"started","method":"listHaikus"}
{"event":"run-method","requestId":"r1","status":"completed","success":true,"method":"listHaikus","output":{...},"error":null,"stdout":[],"duration":145}
```

### `run-scenario`

Run a scenario by ID. Truncates all tables, executes the seed function, and impersonates the scenario's roles.

```json
{"requestId":"r2","action":"run-scenario","scenarioId":"sample-haikus"}
```

Response:
```json
{"event":"run-scenario","requestId":"r2","status":"started","scenarioId":"sample-haikus","name":"Sample Haikus"}
{"event":"run-scenario","requestId":"r2","status":"completed","success":true,"scenarioId":"sample-haikus","name":"Sample Haikus"}
```

### `browser`

Send commands to the browser agent. Commands execute sequentially; steps stop on first error.

```json
{"requestId":"r3","action":"browser","steps":[{"command":"snapshot"}]}
```

Response:
```json
{"event":"browser","requestId":"r3","status":"completed","steps":[{"index":0,"command":"snapshot","result":"navigation \"My App\" [ref=e1]\n  button \"Create\" [ref=e2]\n  ..."}],"duration":250}
```

Times out after 30s if no browser is connected.

Available commands:
- `snapshot` — compact accessibility-tree DOM representation with `[ref=eN]` identifiers
- `click` — click an element by ref, text, role, label, or selector
- `type` — type text into an element (natural typing rhythm)
- `select` — select a dropdown option
- `wait` — wait for an element to appear
- `evaluate` — run custom JavaScript
- `screenshot` — full-page viewport-stitched screenshot
- `reload` — reload the page

### `screenshot`

Capture a full-page screenshot via the browser agent, upload to S3, return the public URL. Times out after 120s.

```json
{"requestId":"r4","action":"screenshot"}
```

Response:
```json
{"event":"screenshot","requestId":"r4","status":"completed","url":"https://...","width":1920,"height":3400,"duration":8500}
```

### `impersonate`

Set a role override. Subsequent method executions will use these roles.

```json
{"requestId":"r5","action":"impersonate","roles":["ap","admin"]}
```

Response:
```json
{"event":"impersonate","requestId":"r5","status":"completed","roles":["ap","admin"]}
```

### `clear-impersonation`

Clear the role override. Reverts to the session's default roles.

```json
{"requestId":"r6","action":"clear-impersonation"}
```

Response:
```json
{"event":"clear-impersonation","requestId":"r6","status":"completed","roles":null}
```

### `browser-status`

Check if any browser agent is connected.

```json
{"requestId":"r7","action":"browser-status"}
```

Response:
```json
{"event":"browser-status","requestId":"r7","status":"completed","connected":true}
```

### `reset-browser`

Reload all connected browser tabs. Fire-and-forget (the reload kills the page).

```json
{"requestId":"r8","action":"reset-browser"}
```

Response:
```json
{"event":"reset-browser","requestId":"r8","status":"completed"}
```

### `dev-server-restarting`

Signal that the upstream dev server is restarting. The proxy's health check will detect recovery and auto-reload the browser.

```json
{"requestId":"r9","action":"dev-server-restarting"}
```

Response:
```json
{"event":"dev-server-restarting","requestId":"r9","status":"completed"}
```

---

## Browser Agent

The proxy injects a `<script>` tag into every HTML response that loads the browser agent (`@mindstudio-ai/browser-agent`). The agent connects to the proxy via WebSocket at `/__mindstudio_dev__/ws`.

**Multi-client support** — multiple browsers can connect simultaneously (IDE iframe, standalone tab, phone). All clients receive broadcast events (reload, etc.). C&C commands (snapshot, click, type) are sent to one preferred client, favoring `mode=iframe` clients.

**Log capture** — always active, writes to `.logs/browser.ndjson`:
- Console output (`console.log/info/warn/error/debug`)
- JS errors (uncaught errors and unhandled promise rejections, with stack traces)
- Network requests (all fetch and XMLHttpRequest calls, with status, duration, and response body for failures)
- Click interactions (element role/name and text content)

**DOM snapshots** — compact, token-efficient accessibility tree:
- Semantic roles and accessible names, not CSS classes (handles styled-components/CSS-in-JS)
- Interactive elements get stable `[ref=eN]` identifiers
- Cursor-interactive elements (`cursor: pointer` divs) are detected and included
- Form values and placeholders shown
- Hidden elements skipped, empty wrapper divs collapsed
- Waits for network idle before walking (200ms settle period, 5s max)

**WebSocket protocol** — the browser agent communicates via WebSocket (replacing the previous HTTP polling approach):
- Client sends `hello` on connect with mode (iframe/standalone), URL, and viewport size
- Server sends `command` messages for C&C, `broadcast` messages for reload/etc.
- Client sends `result` messages after executing commands, `log` messages for browser events
- Auto-reconnects with exponential backoff on disconnection

The browser agent script URL defaults to the latest unpkg release. Override via `browserAgentUrl` in `HeadlessOptions` or the `DevProxy` constructor.

---

## File Watchers

Headless mode automatically watches for file changes. No polling or stdin commands needed.

| What | Trigger | Action |
|------|---------|--------|
| `mindstudio.json` | Any change (500ms debounce) | Full session teardown and restart. Picks up new methods, scenarios, roles, tables. Emits `config-changed` → `session-starting` → `session-started`. |
| Table source directories | File matching a declared table path created or changed (500ms debounce) | Re-read all table sources and sync schema. No session restart. Emits `schema-sync-started` → `schema-sync-completed`. |

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

→ {"requestId":"r1","action":"run-scenario","scenarioId":"sample-haikus"}
← {"event":"run-scenario","requestId":"r1","status":"started","scenarioId":"sample-haikus","name":"Sample Haikus"}
← {"event":"run-scenario","requestId":"r1","status":"completed","success":true,"scenarioId":"sample-haikus","name":"Sample Haikus"}

→ {"requestId":"r2","action":"impersonate","roles":["ap"]}
← {"event":"impersonate","requestId":"r2","status":"completed","roles":["ap"]}

← {"event":"platform-method-started","id":"req-1","method":"getDashboard"}
← {"event":"platform-method-completed","id":"req-1","success":true,"duration":45}

→ {"requestId":"r3","action":"browser","steps":[{"command":"snapshot"}]}
← {"event":"browser","requestId":"r3","status":"completed","steps":[...],"duration":250}

→ {"requestId":"r4","action":"clear-impersonation"}
← {"event":"clear-impersonation","requestId":"r4","status":"completed","roles":null}

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
      const msg = JSON.parse(line);

      if (msg.requestId) {
        // Command response — correlate with your pending request
        console.log(`Response to ${msg.requestId}:`, msg);
      } else {
        // System event
        console.log('System event:', msg);
        if (msg.event === 'session-started') {
          console.log('Proxy available at:', msg.proxyUrl);
        }
      }
    }
  }
});

// Send a command (always include requestId)
tunnel.stdin.write(JSON.stringify({
  requestId: 'cmd-1',
  action: 'run-scenario',
  scenarioId: 'seed-data',
}) + '\n');

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
- Sending commands with unique `requestId` values and correlating responses
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
