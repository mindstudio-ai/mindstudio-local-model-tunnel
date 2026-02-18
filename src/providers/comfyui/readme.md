# ComfyUI

ComfyUI runs video generation models (LTX-Video, Wan2.1) locally. MindStudio handles all the workflow complexity for you -- you just need to install ComfyUI and download a model.

**Default port:** 8188
**Website:** https://www.comfy.org
**GitHub:** https://github.com/comfyanonymous/ComfyUI

## What You'll Need

- **Python 3.10 or newer** -- Check by opening a terminal and typing `python3 --version`. If you don't have it, download from https://www.python.org/downloads/

- **Git** -- Check by typing `git --version`. If you don't have it, download from https://git-scm.com/downloads

- **A GPU with 8+ GB of VRAM** -- Video generation is demanding. Without enough GPU memory, generation will fail or be extremely slow.

## Step 1: Install ComfyUI

Open a terminal and run these commands one at a time, waiting for each to finish before running the next.

Download ComfyUI:

```
git clone https://github.com/comfyanonymous/ComfyUI.git ~/ComfyUI
```

Go into the folder:

```
cd ~/ComfyUI
```

Create an isolated Python environment:

```
python3 -m venv venv
```

Activate the environment:

```
source venv/bin/activate
```

**Windows users:** use `venv\Scripts\activate` instead.

Install dependencies (may take a few minutes):

```
pip install -r requirements.txt
```

## Step 2: Download a Video Model

You need at least one video model for MindStudio to use.

### LTX-Video (recommended to start)

Fastest option, good for getting up and running quickly.

1. Go to https://huggingface.co/Lightricks/LTX-Video
2. Download `ltx-video-2b-v0.9.5.safetensors`
3. Move the file into:

```
~/ComfyUI/models/checkpoints/
```

### Wan2.1

Higher quality but slower and needs more VRAM. Requires multiple files -- make sure you download all of them or it won't work.

1. Go to https://huggingface.co/Comfy-Org/Wan2.1_ComfyUI_repackaged
2. Place UNET files in `~/ComfyUI/models/diffusion_models/`
3. Place text encoder files in `~/ComfyUI/models/text_encoders/`
4. Place VAE files in `~/ComfyUI/models/vae/`

## Step 3: Start the Server

Every time you want to use ComfyUI with MindStudio, open a terminal and run:

```
cd ~/ComfyUI && source venv/bin/activate && python main.py --listen
```

**Windows users:**

```
cd %USERPROFILE%\ComfyUI && venv\Scripts\activate && python main.py --listen
```

**Important:** The `--listen` flag is required. Without it, MindStudio cannot connect to the server.

Leave this terminal window open. When you see "To see the GUI go to: http://0.0.0.0:8188", the server is ready. Go back to the tunnel and select **Refresh Providers** -- your models should appear.

## Troubleshooting

- **MindStudio says ComfyUI is "not running"** -- Make sure you started with the `--listen` flag. Without it, the server won't accept connections from MindStudio.

- **Server is running but no models show up** -- Check that your model files are in the right folders under `~/ComfyUI/models/`. Checkpoint files go in `checkpoints/`, UNET files go in `diffusion_models/`.

- **Generation fails with workflow errors** -- For Wan2.1, you need all three files (UNET, text encoder, VAE). If any are missing, generation will fail.

- **"CUDA out of memory"** -- Video generation needs a lot of GPU memory. Try reducing the resolution or number of frames in your generation settings, or use LTX-Video which is lighter.

- **Server crashes mid-generation** -- Press Ctrl+C in the terminal and run the start command again.
