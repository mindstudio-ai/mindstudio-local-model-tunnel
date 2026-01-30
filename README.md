# MindStudio Local Model Tunnel

Run local models with MindStudio.

Providers supported:

- [Ollama](https://ollama.ai)
- [LM Studio](https://lmstudio.ai/)

With more coming soon...

## Prerequisites

- Node.js 18+
- At least one of these:
  - [Ollama](https://ollama.ai) installed and running with `ollama serve`
  - [LM Studio](https://lmstudio.ai/) installed and local server running

## Installation

```bash
npm install -g @mindstudio-ai/local-model-tunnel
```

## Quick Start

```bash
# Authenticate with MindStudio
mindstudio-local auth

# Register your local models on MindStudio
mindstudio-local register

# Start the tunnel
mindstudio-local start
```

## Commands

| Command    | Description                               |
| ---------- | ----------------------------------------- |
| `auth`     | Authenticate with MindStudio via browser  |
| `register` | Register all local models with MindStudio |
| `start`    | Start the local model tunnel              |
| `models`   | List available local Ollama models        |
| `status`   | Check connection status                   |
| `config`   | Show current configuration                |
| `logout`   | Remove stored credentials                 |

## Options

```bash
# Use custom Ollama URL
mindstudio-local start --ollama-url http://localhost:11434
```

## How It Works

1. Authenticates with your MindStudio account
2. Discovers your local models
3. Polls MindStudio for inference requests
4. Routes requests to local server and streams responses back

## License

MIT
