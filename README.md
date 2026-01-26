# MindStudio Local Model Tunnel

Run local models with MindStudio.

## Prerequisites

- Node.js 18+
- [Ollama](https://ollama.ai) installed and running

## Installation

```bash
npm install -g @mindstudio/local-model-tunnel
```

## Quick Start

```bash
# Authenticate with MindStudio
mindstudio-local auth

# Start the tunnel
mindstudio-local start
```

## Commands

| Command    | Description                               |
| ---------- | ----------------------------------------- |
| `auth`     | Authenticate with MindStudio via browser  |
| `start`    | Start the local model tunnel              |
| `models`   | List available local Ollama models        |
| `register` | Register all local models with MindStudio |
| `status`   | Check connection status                   |
| `config`   | Show current configuration                |
| `logout`   | Remove stored credentials                 |

## Options

```bash
# Use custom Ollama URL
mindstudio-local start --ollama-url http://localhost:11434

# Switch environment (developer use)
mindstudio-local --env local start
```

## How It Works

1. Authenticates with your MindStudio account
2. Discovers local Ollama models
3. Polls MindStudio for inference requests
4. Routes requests to local Ollama and streams responses back

## License

MIT
