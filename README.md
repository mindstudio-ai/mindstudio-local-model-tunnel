# MindStudio Local Model Tunnel

Run local models with MindStudio.

Providers supported so far:

- **Text Generation**

  - [Ollama](https://ollama.ai)
  - [LM Studio](https://lmstudio.ai/)

- **Image Generation**
  - [Stable Diffusion](https://github.com/lllyasviel/stable-diffusion-webui-forge)

## Prerequisites

- Node.js 18+
- At least one provider running:

| Type  | Provider                                                                     | How to Start        |
| ----- | ---------------------------------------------------------------------------- | ------------------- |
| Text  | [Ollama](https://ollama.ai)                                                  | `ollama serve`      |
| Text  | [LM Studio](https://lmstudio.ai/)                                            | Enable local server |
| Image | [SD WebUI Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge) | `./webui.sh --api`  |

See more information below on how to set up each provider.

## Installation

```bash
npm install -g @mindstudio-ai/local-model-tunnel
```

## Quick Start

```bash
# Authenticate with MindStudio
mindstudio-local auth

# Register your local models on MindStudio
# IMPORTANT: Your provider local server has to be running in order to properly detect your local models
# (see Prerequisites above)
mindstudio-local register

# Start the tunnel
mindstudio-local start
```

## How to setup providers

### Ollama

- Download [Ollama](https://ollama.com/download)
- Open the terminal
- Download one or more [models](https://ollama.com/search) with `ollama pull {modelId}`
  - Example: To download the `llama3.2` model:
    `ollama pull llama3.2`
- Run `ollama serve`

## Commands

| Command      | Description                               |
| ------------ | ----------------------------------------- |
| `auth`       | Authenticate with MindStudio via browser  |
| `register`   | Register all local models with MindStudio |
| `start`      | Start the local model tunnel              |
| `models`     | List available local Ollama models        |
| `status`     | Check connection status                   |
| `config`     | Show current configuration                |
| `set-config` | Set configuration                         |
| `logout`     | Remove stored credentials                 |

## Configuration Options

```bash
# Use custom provider URLs
mindstudio-local set-config --ollama-url http://localhost:11434
mindstudio-local set-config --lmstudio-url http://localhost:1234
```

## How It Works

1. Authenticates with your MindStudio account
2. Discovers your local models
3. Polls MindStudio for inference requests
4. Routes requests to local server and streams responses back

## License

MIT
