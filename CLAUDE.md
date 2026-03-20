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

Headless mode accepts NDJSON commands on stdin (one JSON object per line):

**Run a method:**
```json
{"action": "run-method", "method": "listHaikus", "input": {"topic": "cats"}}
```
Looks up the method by export name (falls back to ID). Executes it directly with a fresh callback token -- the method's SDK calls (db queries, etc.) still go through the platform. Returns a `method-run-completed` event on stdout:
```json
{"event": "method-run-completed", "method": "listHaikus", "success": true, "output": {...}, "error": null, "duration": 145}
```

**Run a scenario:**
```json
{"action": "run-scenario", "scenarioId": "populated-boards"}
```
Resets the database, runs the seed function, and sets role overrides. Emits `scenario-started` and `scenario-completed` events.

**Browser commands:**
```json
{"action": "browser", "steps": [{"command": "snapshot"}]}
```
Sends commands to the browser agent running in the app's preview iframe. The browser agent polls `GET /__mindstudio_dev__/commands` every 100ms (only in iframe mode -- detected via `?mode=iframe` in the page URL). Commands execute sequentially and the result is posted back to `POST /__mindstudio_dev__/results`. Returns a `browser-completed` event:
```json
{"event": "browser-completed", "steps": [{"index": 0, "command": "snapshot", "result": "navigation \"My App\" [ref=e1]\n  button \"Create\" [ref=e2]\n  ..."}], "duration": 250}
```
Times out after 30s if no browser is connected. Steps stop on first error.

Available commands:
- `snapshot` -- returns a compact accessibility-tree-style representation of the page DOM, with stable `[ref=eN]` identifiers on interactive elements. Waits for network requests to settle before walking.

**Set/clear role override:**
```json
{"action": "impersonate", "roles": ["admin"]}
{"action": "clear-impersonation"}
```

### Browser Agent

The proxy injects a `<script>` tag into every HTML response that loads the browser agent (`@mindstudio-ai/browser-agent`). The agent captures browser events and provides a command interface for AI agents.

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

**Command channel** -- only active in iframe mode (`?mode=iframe` in URL):
- Polls `GET /__mindstudio_dev__/commands` every 100ms
- Executes commands and posts results to `POST /__mindstudio_dev__/results`

The browser agent script URL defaults to `https://seankoji-msba.ngrok.io/index.js` (for dev). Override via `browserAgentUrl` in `HeadlessOptions` or the `DevProxy` constructor.

### File Watching

- `mindstudio.json` is watched via chokidar. Changes trigger a full session restart (teardown + start).
- Table source files declared in `mindstudio.json` are watched via chokidar. Changes trigger a schema sync without session restart.
- Both watchers handle atomic file writes (write-tmp + rename) correctly on Linux.

### Session Token Refresh

If the platform returns a 401 during polling, the runner automatically initiates the device auth flow (opens browser for re-authorization). On success, the new token is saved and polling resumes. On failure, the session stops.

### Method Execution

Methods run in a persistent worker process (spawned via `fork()`) to avoid Node.js cold-start overhead on each invocation. The worker stays warm across method calls -- the Node runtime and SDK modules are loaded once. The worker is respawned if it crashes, and killed on session stop.
