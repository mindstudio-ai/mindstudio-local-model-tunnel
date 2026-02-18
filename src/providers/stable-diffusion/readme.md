# Stable Diffusion Forge Neo

Forge Neo runs Stable Diffusion image generation models locally.
Once the server is running with at least one model, MindStudio
will detect it automatically.

**Default port:** 7860
**GitHub:** https://github.com/Haoming02/sd-webui-forge-classic

## What You'll Need

- **Python 3.13 or newer** -- Check by opening a terminal and
  typing `python3 --version`. If you don't have it, download
  from https://www.python.org/downloads/

- **Git** -- Check by typing `git --version`. If you don't
  have it, download from https://git-scm.com/downloads

## Step 1: Install Forge Neo

Open a terminal and paste this command:

```
git clone --branch neo https://github.com/Haoming02/sd-webui-forge-classic.git ~/sd-webui-forge-neo
```

**Windows users**, use this instead:

```
git clone --branch neo https://github.com/Haoming02/sd-webui-forge-classic.git %USERPROFILE%\sd-webui-forge-neo
```

## Step 2: Download a Model

You need at least one model file for MindStudio to use. Model
files have the `.safetensors` extension (typically 2-7 GB).

1. Browse models at https://civitai.com or https://huggingface.co
2. Download a `.safetensors` checkpoint file
3. Move the file into this folder:

```
~/sd-webui-forge-neo/models/Stable-diffusion/
```

Good starter models:

- **Stable Diffusion XL (SDXL)** -- high quality, 1024x1024
- **Stable Diffusion 1.5** -- fast, widely supported

## Step 3: Start the Server

Open a terminal and run:

```
cd ~/sd-webui-forge-neo && python3 launch.py --api
```

**Windows users:**

```
cd %USERPROFILE%\sd-webui-forge-neo && python launch.py --api
```

The first time you run this it will take several minutes to
install dependencies. This is normal -- let it finish.

**Important:** The `--api` flag is required. Without it,
MindStudio cannot send requests to the server.

Leave this terminal window open while using MindStudio. Once
the server is ready, go back to the tunnel and select
**Refresh Providers** -- your models should appear.

## Troubleshooting

- **MindStudio says Forge Neo is "not running"** -- Make sure
  you included `--api` when launching. The terminal should show
  the server at `http://127.0.0.1:7860`.

- **Server is running but no models show up** -- Make sure your
  `.safetensors` file is directly in the `models/Stable-diffusion/`
  folder, not inside a subfolder. Restart the server after adding
  new model files.

- **"Python not found"** -- Python 3.13+ is required. Download
  from https://www.python.org/downloads/. On Windows, check
  "Add Python to PATH" during installation.

- **Errors during first launch** -- Delete the `venv` folder
  inside `sd-webui-forge-neo` and run the launch command again
  to reinstall dependencies from scratch.

- **"CUDA out of memory"** -- Your GPU doesn't have enough
  memory. Add `--medvram` or `--lowvram` to the launch command:
  `python3 launch.py --api --medvram`
