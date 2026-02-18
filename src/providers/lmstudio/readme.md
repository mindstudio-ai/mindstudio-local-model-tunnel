# LM Studio

LM Studio is a desktop app for running text generation models
locally. No terminal needed -- everything is done through the
app. Once its server is running, MindStudio will detect it
automatically.

**Default port:** 1234
**Website:** https://lmstudio.ai
**GitHub:** https://github.com/lmstudio-ai

## Step 1: Install LM Studio

1. Go to https://lmstudio.ai
2. Click the download button for your operating system
3. Open the downloaded file and install it like any other app

## Step 2: Download a Model

1. Open LM Studio
2. Click the **Discover** tab on the left sidebar
3. Search for a model (see suggestions below)
4. Click the download button next to the model you want
5. Wait for the download to finish

Good starter models:

- **Llama 3.2** -- great all-around model, fast
- **Mistral** -- efficient and capable
- **Phi-3** -- compact, runs well on most machines

## Step 3: Start the Server

This is the key step -- LM Studio needs to be running its local
server for MindStudio to connect.

1. In LM Studio, click the **Developer** tab on the left sidebar
2. Select a model from the dropdown at the top if one isn't
   already loaded
3. Click **Start Server**

You should see a green indicator showing the server is running
on `http://localhost:1234`.

**Important:** Just opening LM Studio is not enough. You must
start the server from the Developer tab.

Leave LM Studio open with the server running while you use
MindStudio. Go back to the tunnel and select **Refresh Providers**
-- your models should appear.

## Troubleshooting

- **MindStudio says LM Studio is "not running"** -- Make sure
  you started the server in the Developer tab. The green indicator
  should be visible.

- **Server is running but no models show up** -- You need to
  load a model in the Developer tab. Select one from the dropdown
  at the top of the Developer tab before starting the server.

- **Port conflict** -- If something else is using port 1234,
  you can change the port in the Developer tab settings.
