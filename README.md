# MindStudio Local Tunnel

Local tunnel for MindStudio. Use your own locally-running AI models, and edit custom interfaces and scripts for your MindStudio apps — all from your own machine.

## Quick Start

You'll need [Node.js 18+](https://nodejs.org) installed.

```
npm install -g @mindstudio-ai/local-model-tunnel
mindstudio-local
```

The app will walk you through connecting your MindStudio account and getting set up.

## Features

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

## Example: Getting Started with Ollama

The fastest way to get running with text generation:

```
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Download a model
ollama pull llama3.2

# Start the tunnel
mindstudio-local
```

Select **Sync Models** in the dashboard to register your models with MindStudio, and you're ready to go.

## Want a New Provider?

If there's a local AI tool you'd like to use with MindStudio, [open an issue](https://github.com/mindstudio-ai/mindstudio-local-model-tunnel/issues) to request it. Or if you're feeling adventurous, add it yourself -- each provider is a self-contained directory under `src/providers/` and the `CLAUDE.md` file has a full guide for adding one. PRs welcome!

## License

MIT
