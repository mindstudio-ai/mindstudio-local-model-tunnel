# Stable Diffusion WebUI

AUTOMATIC1111's Stable Diffusion WebUI runs image generation models
locally. Once the server is running with at least one model,
MindStudio will detect it automatically.

**Default port:** 7860
**GitHub:** https://github.com/AUTOMATIC1111/stable-diffusion-webui

## What You'll Need

- **Python 3.10 or newer** -- Check by opening a terminal and
  typing `python3 --version`. If you don't have it, download
  from https://www.python.org/downloads/

- **Git** -- Check by typing `git --version`. If you don't
  have it, download from https://git-scm.com/downloads

## Step 1: Install the WebUI

Open a terminal and paste this command:

```
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui.git ~/stable-diffusion-webui
```

**Windows users**, use this instead:

```
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui.git %USERPROFILE%\stable-diffusion-webui
```

## Step 2: Download a Model

You need at least one model file for MindStudio to use. Model
files have the `.safetensors` extension (typically 2-7 GB).

1. Browse models at https://civitai.com or https://huggingface.co
2. Download a `.safetensors` checkpoint file
3. Move the file into this folder:

```
~/stable-diffusion-webui/models/Stable-diffusion/
```

Good starter models:

- **Stable Diffusion XL (SDXL)** -- high quality, 1024x1024
- **Stable Diffusion 1.5** -- fast, widely supported

## Step 3: Start the Server

Open a terminal and run:

```
cd ~/stable-diffusion-webui && ./webui.sh --api
```

**Windows users:**

```
cd %USERPROFILE%\stable-diffusion-webui && webui-user.bat --api
```

The first time you run this it will take several minutes to
install dependencies. This is normal -- let it finish.

**Important:** The `--api` flag is required. Without it,
MindStudio cannot send requests to the server.

Leave this terminal window open while using MindStudio. Once
the server is ready, go back to the tunnel and select
**Refresh Providers** -- your models should appear.

## Troubleshooting

- **MindStudio says WebUI is "not running"** -- Make sure
  you included `--api` when launching. The terminal should show
  the server at `http://127.0.0.1:7860`.

- **Server is running but no models show up** -- Make sure your
  `.safetensors` file is directly in the `models/Stable-diffusion/`
  folder, not inside a subfolder. Restart the server after adding
  new model files.

- **"Python not found"** -- Python 3.10+ is required. Download
  from https://www.python.org/downloads/. On Windows, check
  "Add Python to PATH" during installation.

- **Errors during first launch** -- Delete the `venv` folder
  inside `stable-diffusion-webui` and run the launch command again
  to reinstall dependencies from scratch.

- **"CUDA out of memory"** -- Your GPU doesn't have enough
  memory. Add `--medvram` or `--lowvram` to the launch command:
  `./webui.sh --api --medvram`
