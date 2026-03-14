# MindStudio Local Tunnel

Local tunnel for MindStudio. Use your own locally-running AI models, develop v2 apps with live preview, and edit custom interfaces and scripts — all from your own machine.

## Quick Start

### macOS / Linux (Standlone Binary)

No dependencies required — this downloads a standalone binary:

```
curl -fsSL https://msagent.ai/install-tunnel.sh | bash
mindstudio-local
```

To update, run the same command again. To uninstall, `rm /usr/local/bin/mindstudio-local`.

The app will also prompt you to update automatically when a new version is available.

### Windows (PowerShell)

No dependencies required — this downloads a standalone binary:

```
irm https://msagent.ai/install-tunnel.ps1 | iex
mindstudio-local
```

To update, run the same command again. To uninstall, delete `%USERPROFILE%\.mindstudio\bin\mindstudio-local.exe`.

The app will also prompt you to update automatically when a new version is available.

### Alternative: Install via npm (all platforms)

```
npm install -g @mindstudio-ai/local-model-tunnel
mindstudio-local
```

The app will walk you through connecting your MindStudio account and getting set up.

## Features

### Apps v2 Local Dev Mode

Develop MindStudio Apps v2 locally with instant feedback. The CLI detects your `mindstudio.json`, starts a dev session, and gives you live preview with real auth, databases, and method execution — all running on your machine.

```bash
cd my-app          # must contain mindstudio.json with "appId"
mindstudio-local
```

**What happens:**

1. The CLI reads `mindstudio.json` and enters dev mode automatically
2. Installs dependencies if needed (`npm install` in method/frontend dirs)
3. Starts your frontend dev server (Vite, webpack, etc.)
4. Connects to the MindStudio platform and syncs your table schemas
5. Starts a local proxy that serves your frontend with platform context injected
6. Polls for method execution requests and runs them locally (transpiled on the fly)

**The TUI shows:**

- Session status, branch, and preview URL
- Tabbed views: Info, Requests, Methods, Dev Server logs
- Schema sync results
- Live method execution log with timing and errors

**Key details:**

- Methods are transpiled with esbuild and executed in isolated Node.js child processes
- `@mindstudio-ai/agent` SDK works identically — database queries, auth checks, etc. all go through the real platform
- The local proxy injects `window.__MINDSTUDIO__` into HTML so the frontend SDK works
- Changes to `mindstudio.json` trigger an automatic session restart
- Frontend HMR works through the proxy (WebSocket upgrades are forwarded)

### Headless Mode

Run the dev tunnel without a TUI for programmatic control. Designed for hosted sandboxes, CI pipelines, or any automation that needs the tunnel as a background service.

```bash
mindstudio-local --headless --port 5173 --bind 0.0.0.0
```

**Headless mode does NOT start a dev server** — the caller manages that separately. The `--port` flag tells the tunnel which port to proxy to.

#### CLI Flags

```
mindstudio-local --headless [options]

Options:
  --headless            Run without TUI, output JSON events to stdout
  --port <n>            Dev server port to proxy to (default: from web.json)
  --proxy-port <n>      Preferred proxy port (default: auto from app ID)
  --bind <addr>         Proxy bind address (default: 127.0.0.1)
  --log-level <level>   Log verbosity: error, warn, info, debug (default: info)
```

#### JSON Event Protocol

Stdout emits newline-delimited JSON events — one object per line:

| Event | Key Fields | When |
|-------|-----------|------|
| `starting` | `appId`, `name` | Initializing |
| `session-started` | `sessionId`, `branch`, `proxyPort`, `proxyUrl` | Session active, proxy running |
| `schema-synced` | `created`, `altered`, `errors` | Table schema synced |
| `method-start` | `id`, `method` | Method execution received |
| `method-complete` | `id`, `success`, `duration`, `error?` | Method execution finished |
| `connection-warning` | `message` | Lost platform connection |
| `connection-restored` | | Reconnected |
| `session-expired` | | Platform expired session (exits with code 1) |
| `error` | `message` | Fatal error |
| `stopping` | | Graceful shutdown initiated |
| `stopped` | | Cleanup complete, exiting |

#### Spawning from a Parent Process

```javascript
const { spawn } = require('child_process');

const tunnel = spawn('mindstudio-local', [
  '--headless', '--port', '5173', '--bind', '0.0.0.0'
], {
  cwd: '/path/to/app',
  stdio: ['ignore', 'pipe', 'pipe'],
});

// JSON events from stdout
let buffer = '';
tunnel.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const event = JSON.parse(buffer.slice(0, idx));
    buffer = buffer.slice(idx + 1);

    if (event.event === 'session-started') {
      console.log('Preview:', event.proxyUrl);
    }
  }
});

// Structured logs from stderr
tunnel.stderr.on('data', (chunk) => {
  console.error('[tunnel]', chunk.toString().trimEnd());
});

// Graceful shutdown
process.on('SIGTERM', () => tunnel.kill('SIGTERM'));
```

#### Programmatic API

```typescript
import { startHeadless } from '@mindstudio-ai/local-model-tunnel';

await startHeadless({
  cwd: '/path/to/app',
  devPort: 5173,
  bindAddress: '0.0.0.0',
  logLevel: 'debug',
});
```

### Logging

The tunnel has structured logging throughout — API call timing, method execution lifecycle, transpilation, proxy requests, connection state, and errors.

**Headless mode:** logs go to **stderr** at `info` level by default. Stdout is reserved for the JSON event protocol. Override with `--log-level`:

```bash
mindstudio-local --headless --log-level debug  # verbose logs on stderr
```

**Interactive (TUI) mode:** logs go to `.mindstudio-dev.log` in the working directory at `error` level by default. This keeps logs out of the terminal UI.

**Log format:**

```
[2026-03-14T12:34:56.789Z] INFO  api POST /dev/manage/start → 200 (142ms) {"sessionId":"848583c4","branch":"main"}
[2026-03-14T12:34:57.012Z] INFO  runner Request received {"requestId":"req-1","method":"getDashboard"}
[2026-03-14T12:34:57.024Z] INFO  transpiler Transpiled in 12ms {"methodPath":"dist/methods/src/getDashboard.ts"}
[2026-03-14T12:34:57.089Z] INFO  runner Request complete {"requestId":"req-1","success":true,"duration":77}
```

**Log levels:**

| Level | What you get |
|-------|-------------|
| `error` | Failures only — 403s, timeouts, crashes |
| `warn` | Errors + connection issues, port conflicts, invalid output |
| `info` | Warnings + API timing, request lifecycle, session state changes |
| `debug` | Everything — child process details, config resolution, proxy requests, transpile paths |

### Local Model Tunnel

Connect local AI providers to MindStudio Cloud so you can use your own hardware for text, image, and video generation.

| Provider                                                                          | Capability       | Website     |
| --------------------------------------------------------------------------------- | ---------------- | ----------- |
| [Ollama](https://ollama.com)                                                      | Text generation  | ollama.com  |
| [LM Studio](https://lmstudio.ai)                                                  | Text generation  | lmstudio.ai |
| [Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) | Image generation | github.com  |
| [ComfyUI](https://www.comfy.org)                                                  | Video generation | comfy.org   |

Don't have any of these installed yet? No problem -- select **Manage Providers** in the app for step-by-step setup guides for each one.

**How it works:**

1. You start a local provider (e.g. `ollama serve`)
2. The tunnel detects it and discovers your models
3. You sync your models to MindStudio Cloud
4. When a MindStudio app uses one of your models, the request is routed to your local machine and the response is streamed back

The tunnel stays running and handles requests as they come in. You can see live request logs and status in the dashboard.

### Local Interface & Script Editing

Edit custom interfaces (SPAs) and scripts from your MindStudio apps locally. Open any app that's active in the MindStudio editor, clone its interfaces or scripts to your machine, and develop with a local dev server — complete with hot reloading for interfaces.

**How it works:**

1. Open an app in the MindStudio editor
2. Select **Interfaces** in the CLI dashboard
3. Pick an interface or script from your app
4. The CLI clones the scaffold and starts a local dev server
5. Edit with your preferred tools — the CLI provides ready-to-use commands for Claude Code and Codex

## Development

```bash
npm install
npm run build           # Build with tsup
npm run dev             # Build + run CLI
npm run local-update    # Build + npm link for local testing
```

### Install from a branch

```bash
npm i -g mindstudio-ai/mindstudio-local-model-tunnel#branch-name
```

The `prepare` script runs `npm run build` automatically after clone.

## Configuration

Credentials are stored in `~/.mindstudio-local-tunnel/config.json`. The config supports two environments (`prod` and `local`) with separate API keys and base URLs.

The TUI's onboarding flow handles initial setup. For headless/sandbox use, write the config file directly:

```json
{
  "environment": "prod",
  "environments": {
    "prod": {
      "apiKey": "sk_...",
      "userId": "...",
      "apiBaseUrl": "https://api.mindstudio.ai"
    }
  }
}
```

## Want a New Provider?

If there's a local AI tool you'd like to use with MindStudio, [open an issue](https://github.com/mindstudio-ai/mindstudio-local-model-tunnel/issues) to request it. Or if you're feeling adventurous, add it yourself -- each provider is a self-contained directory under `src/providers/` and the `CLAUDE.md` file has a full guide for adding one. PRs welcome!

## License

MIT
