# MindStudio Local Model Tunnel

Run local models with MindStudio.

Only Ollama is supported right now, with more providers coming soon.

## Prerequisites

- Node.js 18+
- [Ollama](https://ollama.ai) installed and running

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
2. Discovers local Ollama models
3. Polls MindStudio for inference requests
4. Routes requests to local Ollama and streams responses back

## License

MIT
