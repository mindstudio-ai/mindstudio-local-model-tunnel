# Headless Dev Mode

Run the MindStudio dev tunnel without a terminal UI. Headless mode
outputs structured JSON events to stdout, designed for programmatic
control by a parent process — a sandbox C&C server, CI pipeline, or
any automation that needs to run the dev tunnel as a background
service.

---

## Quick Start

```bash
cd /path/to/your-app    # must contain mindstudio.json with "appId"
mindstudio-local --headless --port 5173
```

The tunnel reads `mindstudio.json`, starts a platform session, syncs
table schemas, starts the local proxy, and enters the poll loop. JSON
events stream to stdout. The process runs until killed (SIGTERM/SIGINT)
or the session expires.

**The tunnel does NOT start a dev server.** You manage the dev server
(Vite, webpack, etc.) separately. The `--port` flag tells the tunnel
which port to proxy to.

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

## JSON Event Protocol

Every line written to stdout is a JSON object with an `event` field.
Events are newline-delimited (one JSON object per line).

### Lifecycle Events

**`starting`** — Headless mode is initializing.
```json
{"event":"starting","appId":"e452fcf2-...","name":"Procure-to-Pay"}
```

**`session-started`** — Platform session is active, proxy is running,
the tunnel is polling for work.
```json
{
  "event": "session-started",
  "sessionId": "848583c4-...",
  "releaseId": "848583c4-...",
  "branch": "main",
  "proxyPort": 3835,
  "proxyUrl": "http://localhost:3835/",
  "webInterfaceUrl": "https://848583c4.static.mscdn.ai/?__ms_token=..."
}
```

`proxyPort` and `proxyUrl` are `null` if no dev server port was
configured (backend-only mode).

**`schema-synced`** — Table schema sync completed (runs on startup).
```json
{"event":"schema-synced","created":["vendors","purchase_orders"],"altered":[],"errors":[]}
```

**`stopping`** — Graceful shutdown initiated (SIGTERM/SIGINT received).
```json
{"event":"stopping"}
```

**`stopped`** — All resources cleaned up. The process will exit.
```json
{"event":"stopped"}
```

### Method Execution Events

**`method-start`** — A method execution request was received from the
platform.
```json
{"event":"method-start","id":"req-uuid-1","method":"getDashboard"}
```

**`method-complete`** — Method execution finished.
```json
{"event":"method-complete","id":"req-uuid-1","success":true,"duration":45}
```

On failure:
```json
{"event":"method-complete","id":"req-uuid-1","success":false,"duration":120,"error":"[db] query failed: ..."}
```

### Connection Events

**`connection-warning`** — Lost connection to the platform, retrying
with exponential backoff.
```json
{"event":"connection-warning","message":"Lost connection to platform, retrying..."}
```

**`connection-restored`** — Reconnected after a connection loss.
```json
{"event":"connection-restored"}
```

**`session-expired`** — The platform expired the dev session (404 on
poll). The process will exit with code 1.
```json
{"event":"session-expired"}
```

### Error Events

**`error`** — A fatal error occurred during startup. The process will
exit.
```json
{"event":"error","message":"Missing \"appId\" in mindstudio.json"}
```

---

## Integration Guide

### Spawning from a parent process (Node.js)

```javascript
import { spawn } from 'child_process';

const tunnel = spawn('mindstudio-local', ['--headless', '--port', '5173', '--bind', '0.0.0.0'], {
  cwd: '/workspace/my-app',
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Read JSON events from stdout
let buffer = '';
tunnel.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx);
    buffer = buffer.slice(newlineIdx + 1);
    if (line.trim()) {
      const event = JSON.parse(line);
      console.log('Tunnel event:', event);

      if (event.event === 'session-started') {
        console.log('Proxy available at:', event.proxyUrl);
      }
    }
  }
});

// Stderr has any unexpected errors
tunnel.stderr.on('data', (chunk) => {
  console.error('Tunnel stderr:', chunk.toString());
});

// Graceful shutdown
process.on('SIGTERM', () => {
  tunnel.kill('SIGTERM');
});
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

Note: when using the programmatic API, JSON events are still written
to `process.stdout`. Subscribe to `devRequestEvents` from
`src/dev/events.ts` if you need in-process event handling.

### Shutdown

Send `SIGTERM` to the process for graceful shutdown. The tunnel will:
1. Emit `{"event":"stopping"}`
2. Stop the proxy server
3. Stop the platform session (POST /dev/manage/stop)
4. Emit `{"event":"stopped"}`
5. Exit with code 0

`SIGINT` (Ctrl+C) behaves identically.

If the session expires (platform returns 404 on poll), the tunnel
emits `session-expired` and exits with code 1.

---

## Proxy Configuration

The local proxy sits in front of the dev server and injects
`window.__MINDSTUDIO__` into HTML responses. All other requests (JS,
CSS, images, WebSocket upgrades for HMR) are forwarded unchanged.

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

The proxy port is reported in the `session-started` event. If no
`--port` is provided and no `devPort` is found in `web.json`, the
proxy is not started (backend-only mode — only method execution
works, no frontend).

---

## Architecture

```
                         ┌─────────────────────┐
                         │  mindstudio-local    │
                         │  --headless          │
                         ├─────────────────────┤
                         │  DevRunner           │ ← polls platform, executes methods
                         │  DevProxy            │ ← proxies dev server, injects __MINDSTUDIO__
                         │  Transpiler          │ ← esbuild TypeScript → JS
                         │  Executor            │ ← isolated Node.js child processes
                         └──────┬──────────────┘
                                │ stdout: JSON events
                                ▼
                     ┌─────────────────────┐
                     │  Parent Process      │ ← C&C server, CI, etc.
                     │  (reads JSON events) │
                     └─────────────────────┘
```

Headless mode uses the exact same `DevRunner`, `DevProxy`,
`Transpiler`, and executor code as the TUI mode. The only
difference is the orchestration layer: instead of React hooks
and Ink components, it's a simple async function that wires
the pieces together and logs events.

### What's shared with TUI mode

| Module | Path | Used By |
|--------|------|---------|
| DevRunner | `src/dev/runner.ts` | Both |
| DevProxy | `src/dev/proxy.ts` | Both |
| Transpiler | `src/dev/transpiler.ts` | Both |
| Executor | `src/dev/executor.ts` | Both |
| API client | `src/dev/api.ts` | Both |
| Events | `src/dev/events.ts` | Both |
| App config | `src/dev/app-config.ts` | Both |
| Types | `src/dev/types.ts` | Both |

### What's different

| Concern | TUI Mode | Headless Mode |
|---------|----------|---------------|
| Orchestration | React hooks (`useDevSession`) | `startHeadless()` async function |
| Output | Ink terminal UI | JSON events to stdout |
| Dev server | Started by TUI (`useDevServer`) | Managed externally |
| User input | Keyboard (tabs, menu) | SIGTERM/SIGINT only |
| Dependencies | React, Ink, ink-spinner, etc. | None (just Node.js stdlib) |
