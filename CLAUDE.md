# MindStudio Local Developer Tools

CLI tool for local MindStudio development. Connects local AI providers (Ollama, LM Studio, Stable Diffusion, ComfyUI) to MindStudio Cloud, and supports local editing of custom interfaces and scripts from the MindStudio IDE.

## Build & Run

```
npm run build        # build with tsup
npm run dev          # run in development
node dist/cli.js     # run built CLI
```

## Adding a New Provider

Providers live in `src/providers/`. Each provider is a directory with an `index.ts` and a `readme.md`.

### 1. Create the provider directory

```
src/providers/my-provider/
  index.ts     # Provider class
  readme.md    # Setup guide shown in the TUI
```

### 2. Implement the Provider interface

The class must implement `Provider` from `src/providers/types.ts`. Use Ollama (`src/providers/ollama/index.ts`) as the simplest reference.

Required fields:

- `name` -- unique identifier (e.g. `'my-provider'`)
- `displayName` -- shown in the TUI (e.g. `'My Provider'`)
- `description` -- one-line description for the provider list
- `capabilities` -- array of `'text' | 'image' | 'video'`
- `readme` -- imported from `./readme.md`
- `defaultBaseUrl` -- the provider's default local URL
- `baseUrl` -- getter using `getProviderBaseUrl(this.name, this.defaultBaseUrl)` from `src/config.ts`

Required methods:

- `isRunning()` -- check if the provider's server responds (use `fetch` with `AbortSignal.timeout`)
- `detect()` -- return `{ installed, running }`. Check for files on disk or CLI commands for `installed`, call `isRunning()` for `running`
- `discoverModels()` -- query the running server for available models, return `LocalModel[]` with `provider: this.name`

Capability methods (implement based on `capabilities`):

- `chat()` -- async generator yielding `{ content, done }` chunks for text providers
- `generateImage()` -- return `{ imageBase64, mimeType }` for image providers
- `generateVideo()` -- return `{ videoBase64, mimeType }` for video providers
- `getParameterSchemas()` -- optional, return UI parameter definitions

Export a singleton instance as the default export:

```typescript
export default new MyProvider();
```

### 3. Write the readme.md

This is displayed in the TUI's "Manage Providers" detail view, rendered with `marked` + `marked-terminal`. Write it as standard markdown with long paragraphs (no hard line breaks -- the renderer handles wrapping).

Structure it as: title, intro paragraph, prerequisites, step-by-step install/setup, troubleshooting. See existing readmes for the pattern.

### 4. Register the provider

Import and add the provider to the `allProviders` array in `src/providers/index.ts`:

```typescript
import myProvider from './my-provider';

export const allProviders: Provider[] = [
  ollama,
  lmstudio,
  stableDiffusion,
  comfyui,
  myProvider,
];
```

That's it -- the TUI, model discovery, and request handling all work off the `allProviders` registry automatically.

### Notes

- `.md` files are bundled as text strings via tsup's `loader: { '.md': 'text' }` and the type declaration in `src/markdown.d.ts`
- Use `getProviderBaseUrl()` and `getProviderInstallPath()` from `src/config.ts` for user-configurable paths/URLs
- `commandExists()` from `src/providers/utils.ts` checks if a CLI tool is on PATH
- Never check Python versions or other runtime details in `detect()` -- just check installed + running

## Dev Mode (Headless)

Headless mode (`--headless`) runs the dev tunnel without a TUI, outputting structured JSON events to stdout and logs to stderr. Used by sandbox environments and CI.

### Logs

Operational logs go to stderr at configurable levels (`error` > `warn` > `info` > `debug`). Default is `info`. Log messages use plain English without module-name prefixes (e.g. "Method failed", not "runner Request failed").

### Request Log

Every method and scenario execution is logged to `.logs/requests.ndjson` in the project root. Each line is a JSON object with full execution details, designed for AI agent consumption and frontend dashboards.

**Method entries** (`type: "method"`) include:
- `method`, `path` -- which method was called
- `input` -- the exact input payload
- `output` -- the return value (if successful)
- `error` -- full error object with `message`, `stack`, `code`, `statusCode`, `response`, `body`, `cause` (if failed)
- `stdout` -- captured `console.log`/`warn`/`error` output from the method
- `databases` -- tables and schemas available at execution time
- `duration` -- total time in ms
- `stats` -- memory usage and execution time breakdown
- `authorizationToken` -- the callback token for platform API calls

**Scenario entries** (`type: "scenario"`) include the same fields, plus a `scenario` object with `id`, `name`, `export`, and `path`.

The log auto-rotates to keep the most recent 300 entries.

Useful commands:

```bash
tail -5 .logs/requests.ndjson | jq .          # last 5 executions
grep '"success":false' .logs/requests.ndjson | jq .  # failed methods
```

### Stdin Commands

Headless mode accepts NDJSON commands on stdin (one JSON object per line). Every command must include a `requestId` for response correlation.

**Response protocol:** All command responses include `event`, `requestId`, `status` ("started" or "completed"), and `success` (boolean). Failed responses include `error` (human-readable string) and `errorCode` (machine-readable code). System events (session lifecycle, connection health) have no `requestId`.

**Error codes:**

| Code | Meaning |
|---|---|
| `NO_SESSION` | No active dev session |
| `NO_BROWSER` | No browser agent connected via WebSocket |
| `BROWSER_TIMEOUT` | Browser command timed out (120s) |
| `BROWSER_DISCONNECTED` | Browser disconnected mid-command |
| `BROWSER_SEND_FAILED` | Failed to send command over WebSocket |
| `BROWSER_ERROR` | Browser agent returned an error in step results |
| `INVALID_INPUT` | Missing or invalid required fields |
| `EXECUTION_ERROR` | Method/scenario/query threw during execution |
| `UNKNOWN_ACTION` | Unrecognized action field |
| `UPLOAD_FAILED` | Screenshot upload to S3 failed |
| `INFRASTRUCTURE` | Catch-all for unexpected errors |

**Run a method:**
```json
{"requestId": "r1", "action": "run-method", "method": "listHaikus", "input": {"topic": "cats"}}
```
Looks up the method by export name (falls back to ID). Executes it directly with a fresh callback token. Optional `roles` (string array) and `userId` (string) fields override the auth context for this execution without affecting session state. Response:
```json
{"event": "run-method", "requestId": "r1", "status": "started", "method": "listHaikus"}
{"event": "run-method", "requestId": "r1", "status": "completed", "success": true, "method": "listHaikus", "output": {...}, "duration": 145}
```
On failure, `error` is a string message, `errorCode` is `EXECUTION_ERROR`, and `errorDetail` contains the full error object (with `message`, `stack`, etc.).

**Run a scenario:**
```json
{"requestId": "r2", "action": "run-scenario", "scenarioId": "populated-boards"}
```
Resets the database, runs the seed function, and sets role overrides. Response includes `started` and `completed` events with matching `requestId`.

**Browser commands:**
```json
{"requestId": "r3", "action": "browser", "steps": [{"command": "snapshot"}]}
```
Sends commands to the browser agent via WebSocket. Commands execute sequentially; steps stop on first error. Response:
```json
{"event": "browser", "requestId": "r3", "status": "completed", "success": true, "steps": [{"index": 0, "command": "snapshot", "result": "..."}], "duration": 250}
```
Times out after 120s. If the browser disconnects mid-command, rejects after a 10s grace period (to allow for navigation reconnects).

Available commands:
- `snapshot` -- returns a compact accessibility-tree-style representation of the page DOM, with stable `[ref=eN]` identifiers on interactive elements. Waits for network requests to settle before walking.

**Check browser connection:**
```json
{"requestId": "r3b", "action": "browser-status"}
```
Returns `{"connected": true/false}`. Use before sending browser commands to avoid waiting for a timeout.

**Set/clear role override:**
```json
{"requestId": "r4", "action": "impersonate", "roles": ["admin"]}
{"requestId": "r5", "action": "clear-impersonation"}
```

**Setup browser auth:**
```json
{"requestId": "r6", "action": "setup-browser", "auth": {"email": "user@example.com", "roles": ["admin"]}, "path": "/dashboard"}
```
Mints an auth cookie, injects it into the browser, reloads, and optionally navigates to a path.

**Database query:**
```json
{"requestId": "r7", "action": "db-query", "sql": "SELECT * FROM users LIMIT 10"}
```
Executes a SQL query against the dev database. Optional `databaseId` field; defaults to the first database.

### Browser Agent

The proxy injects a `<script>` tag into every HTML response that loads the browser agent (`@mindstudio-ai/browser-agent`). The agent connects via WebSocket to `/__mindstudio_dev__/ws` and provides a command interface for AI agents.

**Multi-client support** -- multiple browsers can connect (IDE iframe, standalone tab, phone). All clients receive broadcasts (reload). C&C commands go to one preferred client, favoring `mode=iframe`.

**Log capture** -- always active, writes to `.logs/browser.ndjson`:
- Console output (`console.log/info/warn/error/debug`)
- JS errors (uncaught errors and unhandled promise rejections, with stack traces)
- Network requests (all fetch and XMLHttpRequest calls, with status, duration, and response body for failures)
- Click interactions (element role/name and text content)

**DOM snapshots** -- compact, token-efficient accessibility tree:
- Semantic roles and accessible names, not CSS classes (handles styled-components/CSS-in-JS)
- Interactive elements get stable `[ref=eN]` identifiers
- Cursor-interactive elements (`cursor: pointer` divs) are detected and included
- Form values and placeholders shown
- Hidden elements skipped, empty wrapper divs collapsed
- Waits for network idle before walking (200ms settle period, 5s max)

**WebSocket communication** -- browser agent connects via WS (replaces HTTP polling):
- Client sends `hello` on connect with mode, URL, viewport
- Server sends `command` (C&C) and `broadcast` (reload) messages
- Client sends `result` and `log` messages
- Auto-reconnects with exponential backoff

The browser agent script URL defaults to unpkg latest. Override via `browserAgentUrl` in `HeadlessOptions` or the `DevProxy` constructor.

### File Watching

- `mindstudio.json` is watched via chokidar. Changes trigger a full session restart (teardown + start).
- Table source files declared in `mindstudio.json` are watched via chokidar. Changes trigger a schema sync without session restart.
- Both watchers handle atomic file writes (write-tmp + rename) correctly on Linux.

### Session Token Refresh

If the platform returns a 401 during polling, the runner automatically initiates the device auth flow (opens browser for re-authorization). On success, the new token is saved and polling resumes. On failure, the session stops.

### Method Execution

Methods run in a persistent worker process (spawned via `fork()`) to avoid Node.js cold-start overhead on each invocation. The worker stays warm across method calls -- the Node runtime and SDK modules are loaded once. The worker is respawned if it crashes, and killed on session stop.

**Auth context:** Dev sessions default to anonymous (`auth.userId = null`, `auth.roles = []`), matching production behavior. Users get a real identity by logging in through the app's auth flow, impersonating via a scenario, or passing `roles`/`userId` on `run-method`. The platform developer's identity never leaks into the app auth context.

**Execution modes:** SDK >= 0.1.46 uses `runWithContext()` + AsyncLocalStorage for concurrent execution with per-request auth scoping. Older SDKs use a serialized queue with global state. Detection is automatic based on installed `@mindstudio-ai/agent` version.

**Secrets:** Per-request `secrets` (from the poll queue) are injected into `process.env` before each method execution and cleaned up after. Never logged or persisted.
