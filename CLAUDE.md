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
