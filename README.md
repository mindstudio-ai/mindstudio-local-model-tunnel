# MindStudio Local Model Tunnel

Run local models with MindStudio.

Providers supported so far:

- **Text Generation**
  - [Ollama](https://ollama.ai)
  - [LM Studio](https://lmstudio.ai/)

- **Image Generation**
  - [Stable Diffusion Forge Neo](https://github.com/Haoming02/sd-webui-forge-classic/tree/neo)

## Prerequisites

- Node.js 18+

## Installation

```bash
npm install -g @mindstudio-ai/local-model-tunnel
```

## Quick Start

```bash
# Launch the interactive menu
mindstudio-local
```

This opens an interactive home screen where you can:

- **Setup** - Install and configure local AI providers (Ollama, LM Studio, Stable Diffusion)
- **Authenticate** - Log in to MindStudio
- **Register Models** - Register your local models with MindStudio
- **Start Tunnel** - Launch the local model tunnel
- **View Models** - See available local models
- **Configuration** - View current settings

### Manual Commands

If you prefer command-line usage:

```bash
# Run the setup wizard
mindstudio-local setup

# Authenticate with MindStudio
mindstudio-local auth

# Register your local models
mindstudio-local register

# Start the tunnel
mindstudio-local start
```

## Setup Wizard

The setup wizard (`mindstudio-local setup`) helps you install and configure providers:

**Ollama:**

- Auto-install Ollama (Linux/macOS)
- Start/stop Ollama server
- Download models from [ollama.com/library](https://ollama.com/library)

**LM Studio:**

- Opens download page in browser
- Guides you through enabling the local server

**Stable Diffusion Forge:**

- Clones the repository to your chosen location
- Provides setup instructions
- Tip: Download models from [civitai.com](https://civitai.com) (filter by "SDXL 1.0")

## Provider Setup (Manual)

### Ollama

1. Download [Ollama](https://ollama.com/download)
2. Pull a model: `ollama pull llama3.2` (see [all models](https://ollama.com/library))
3. Start the server: `ollama serve`

### LM Studio

1. Download [LM Studio](https://lmstudio.ai/download)
2. Download a model through the app
3. Enable the [Local Server](https://lmstudio.ai/docs/developer/core/server#running-the-server)

### Stable Diffusion (Forge Neo)

**First-time setup:**

```bash
git clone --branch neo https://github.com/Haoming02/sd-webui-forge-classic.git sd-webui-forge-neo
cd sd-webui-forge-neo
python launch.py --api
```

**Subsequent runs:**

```bash
cd sd-webui-forge-neo
python launch.py --api
```

## Commands

| Command      | Description                               |
| ------------ | ----------------------------------------- |
| _(none)_     | Open interactive home screen              |
| `setup`      | Interactive setup wizard for providers    |
| `auth`       | Authenticate with MindStudio via browser  |
| `register`   | Register all local models with MindStudio |
| `start`      | Start the local model tunnel              |
| `models`     | List available local models               |
| `status`     | Check connection status                   |
| `config`     | Show current configuration                |
| `set-config` | Set configuration                         |
| `logout`     | Remove stored credentials                 |

## Configuration Options

```bash
# Use custom provider URLs
mindstudio-local set-config --ollama-url http://localhost:11434
mindstudio-local set-config --lmstudio-url http://localhost:1234/v1
mindstudio-local set-config --sd-url http://127.0.0.1:7860
```

## How It Works

1. Authenticates with your MindStudio account
2. Discovers your local models
3. Polls MindStudio for inference requests
4. Routes requests to local server and streams responses back

## License

MIT
