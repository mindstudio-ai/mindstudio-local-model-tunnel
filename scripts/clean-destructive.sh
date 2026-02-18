#!/usr/bin/env bash
# Wipes ALL mindstudio-local config, auth, and installed providers.
# For debugging the first-launch onboarding flow.
set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${RED}=== DESTRUCTIVE CLEAN ===${NC}"
echo "This will remove:"
echo "  - mindstudio-local config & auth"
echo "  - Ollama (brew uninstall + data)"
echo "  - LM Studio app"
echo "  - SD Forge Neo (~/.sd-webui-forge-neo, ~/sd-webui-forge-neo)"
echo "  - ComfyUI (~/ComfyUI)"
echo ""
read -p "Are you sure? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# 1. Wipe mindstudio-local config (Conf stores in ~/Library/Preferences on macOS)
echo -e "\n${YELLOW}[1/5] Removing mindstudio-local config...${NC}"
CONFIG_DIR="$HOME/.mindstudio-local-tunnel"
if [ -d "$CONFIG_DIR" ]; then
  rm -rf "$CONFIG_DIR"
  echo -e "${GREEN}  Removed $CONFIG_DIR${NC}"
else
  echo "  Not found: $CONFIG_DIR (skipping)"
fi

# 2. Uninstall Ollama
echo -e "\n${YELLOW}[2/5] Removing Ollama...${NC}"
if command -v ollama &>/dev/null; then
  # Stop Ollama if running
  pkill -f "ollama serve" 2>/dev/null || true
  launchctl remove "com.ollama.ollama" 2>/dev/null || true

  if command -v brew &>/dev/null && brew list ollama &>/dev/null; then
    brew uninstall ollama
    echo -e "${GREEN}  Uninstalled ollama via brew${NC}"
  elif [ -d "/Applications/Ollama.app" ]; then
    rm -rf "/Applications/Ollama.app"
    echo -e "${GREEN}  Removed /Applications/Ollama.app${NC}"
  else
    echo "  ollama binary found but no known install method — remove manually"
  fi
else
  echo "  Ollama not installed (skipping)"
fi
# Remove Ollama data
OLLAMA_DATA="$HOME/.ollama"
if [ -d "$OLLAMA_DATA" ]; then
  rm -rf "$OLLAMA_DATA"
  echo -e "${GREEN}  Removed $OLLAMA_DATA${NC}"
fi

# 3. Remove LM Studio
echo -e "\n${YELLOW}[3/5] Removing LM Studio...${NC}"
if [ -d "/Applications/LM Studio.app" ]; then
  rm -rf "/Applications/LM Studio.app"
  echo -e "${GREEN}  Removed /Applications/LM Studio.app${NC}"
else
  echo "  LM Studio not found (skipping)"
fi
LMS_DATA="$HOME/.cache/lm-studio"
if [ -d "$LMS_DATA" ]; then
  rm -rf "$LMS_DATA"
  echo -e "${GREEN}  Removed $LMS_DATA${NC}"
fi

# 4. Remove Stable Diffusion Forge Neo
echo -e "\n${YELLOW}[4/5] Removing Stable Diffusion Forge Neo...${NC}"
SD_REMOVED=false
for SD_DIR in \
  "$HOME/sd-webui-forge-neo" \
  "$HOME/sd-webui-forge-classic" \
  "$HOME/stable-diffusion-webui-forge" \
  "$HOME/sd-forge" \
  "$HOME/Projects/sd-webui-forge-neo" \
  "$HOME/Code/sd-webui-forge-neo"; do
  if [ -d "$SD_DIR" ]; then
    rm -rf "$SD_DIR"
    echo -e "${GREEN}  Removed $SD_DIR${NC}"
    SD_REMOVED=true
  fi
done
if [ "$SD_REMOVED" = false ]; then
  echo "  No SD installations found (skipping)"
fi

# 5. Remove ComfyUI
echo -e "\n${YELLOW}[5/5] Removing ComfyUI...${NC}"
COMFY_REMOVED=false
for COMFY_DIR in \
  "$HOME/ComfyUI" \
  "$HOME/comfyui" \
  "$HOME/Projects/ComfyUI" \
  "$HOME/Code/ComfyUI"; do
  if [ -d "$COMFY_DIR" ]; then
    rm -rf "$COMFY_DIR"
    echo -e "${GREEN}  Removed $COMFY_DIR${NC}"
    COMFY_REMOVED=true
  fi
done
if [ "$COMFY_REMOVED" = false ]; then
  echo "  No ComfyUI installations found (skipping)"
fi

echo -e "\n${GREEN}Done. You're back to a clean slate.${NC}"
