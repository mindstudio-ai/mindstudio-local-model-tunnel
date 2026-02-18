# Ollama

Ollama lets you run text generation models (Llama, Mistral, Gemma, etc.) locally. Once it's running with at least one model downloaded, MindStudio will detect it automatically.

**Default port:** 11434
**Website:** https://ollama.com
**GitHub:** https://github.com/ollama/ollama

## Step 1: Install Ollama

### macOS / Linux

Open a terminal and paste this command:

```
curl -fsSL https://ollama.com/install.sh | sh
```

### macOS (alternative)

Download the app from https://ollama.com/download, open the file, and drag it into your Applications folder.

### Windows

Download the installer from https://ollama.com/download and run it. Follow the on-screen instructions.

## Step 2: Start the Server

Open a terminal and run:

```
ollama serve
```

Leave this terminal window open -- the server needs to keep running for MindStudio to connect to it.

**macOS tip:** If you installed Ollama as a desktop app, the server starts automatically when you open it. Look for the Ollama icon in your menu bar -- if it's there, you can skip this step.

## Step 3: Download a Model

Open a **new** terminal window (keep the server running in the other one) and download a model:

```
ollama pull llama3.2
```

Some good models to start with:

- **llama3.2** -- fast, great all-around model (2 GB download)
- **mistral** -- efficient for most tasks (4 GB)
- **gemma2** -- Google's open model (5 GB)

Browse more models at https://ollama.com/library

Once the download finishes, go back to the MindStudio tunnel and select **Refresh Providers**. Your models should appear.

## Troubleshooting

- **MindStudio says Ollama is "not running"** -- Make sure `ollama serve` is running in a terminal window. You should see "Listening on 127.0.0.1:11434" in the output.

- **Ollama is running but no models show up** -- You need to download at least one model first. Run `ollama pull llama3.2` in a separate terminal window.

- **"address already in use"** -- Ollama is probably already running. On macOS, check for the Ollama icon in your menu bar. On Linux, run `pkill ollama` and try `ollama serve` again.

- **"out of memory" errors** -- Your machine doesn't have enough RAM for that model. Try a smaller one like `llama3.2` (2 GB).
