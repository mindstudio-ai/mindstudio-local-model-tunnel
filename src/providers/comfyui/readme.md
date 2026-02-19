# ComfyUI

ComfyUI is a node-based workflow tool for running image and video generation models locally. MindStudio automatically discovers your saved workflows and makes them available as models -- any workflow you build or download in ComfyUI can be used through MindStudio.

**Default port:** 8188
**Website:** https://www.comfy.org

## What You'll Need

- **A GPU with 8+ GB of VRAM** -- Image and video generation is demanding. Without enough GPU memory, generation will fail or be extremely slow.

## Step 1: Install ComfyUI

Download and install ComfyUI Desktop from the official website:

https://www.comfy.org/download

The installer handles Python, dependencies, and everything else automatically. Follow the on-screen prompts to complete setup.

## Step 2: Save a Workflow

MindStudio discovers workflows you've saved in ComfyUI. If you don't have any saved workflows yet, open the ComfyUI interface in your browser (http://127.0.0.1:8188), build or load a workflow, and save it using the menu. Downloaded workflow files placed in ComfyUI's workflows folder will also be discovered.

Any workflow that produces image or video output will work. MindStudio detects the output type automatically based on the nodes in your workflow.

## Step 3: Start the Server

Open ComfyUI Desktop. Once it's running, go back to the tunnel and select **Refresh Providers** -- your saved workflows should appear as models.

If you're running ComfyUI from the command line instead, start it with:

```
cd ~/ComfyUI && python main.py --listen
```

**Important:** The `--listen` flag is required when running from the command line. Without it, MindStudio cannot connect to the server.

## Tip: Workflow Converter

MindStudio automatically installs a custom node called `comfyui-workflow-to-api-converter-endpoint` into ComfyUI's `custom_nodes/` folder. This converts workflows saved in ComfyUI's UI format into the API format needed for execution. **After the first run, you'll need to restart ComfyUI once** so it picks up the new node — after that, it works automatically. If the auto-install doesn't work (e.g. permissions issues), you can install it manually by cloning https://github.com/SethRobinson/comfyui-workflow-to-api-converter-endpoint into your ComfyUI `custom_nodes/` directory and restarting ComfyUI. Without this node, only workflows already saved in API format will be discovered.

## Troubleshooting

- **MindStudio says ComfyUI is "not running"** -- Make sure ComfyUI Desktop is open, or if running from the terminal, that you started with the `--listen` flag.

- **Server is running but no workflows show up** -- Make sure you have at least one saved workflow in ComfyUI. Open the ComfyUI interface, load or build a workflow, and save it.

- **"CUDA out of memory"** -- Your GPU doesn't have enough memory for the workflow you're running. Try a lighter model or reduce resolution in your workflow.

- **Server crashes mid-generation** -- Restart ComfyUI Desktop, or press Ctrl+C in the terminal and run the start command again.
