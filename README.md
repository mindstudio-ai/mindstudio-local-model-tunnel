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

## Provider Setup

### Ollama

1. Download [Ollama](https://ollama.com/download)
2. Pull a model: `ollama pull llama3.2` (see [all models](https://ollama.com/search))
3. Start the server: `ollama serve`

### LM Studio

1. Download [LM Studio](https://lmstudio.ai/download)
2. Download a model through the app
3. Enable the [Local Server](https://lmstudio.ai/docs/developer/core/server#running-the-server)

### Stable Diffusion (Forge)

**First-time setup:**
```bash
git clone https://github.com/lllyasviel/stable-diffusion-webui-forge.git
cd stable-diffusion-webui-forge
./webui.sh --api
```

**Subsequent runs:**
```bash
cd stable-diffusion-webui-forge
./webui.sh --api
```



## Commands

| Command      | Description                               |
| ------------ | ----------------------------------------- |
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
