#!/bin/bash
set -euo pipefail

BASE_URL="https://f.mscdn.ai/local-model-tunnel"
BINARY_NAME="mindstudio-local"
INSTALL_DIR="/usr/local/bin"

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *)
    echo "Error: Unsupported operating system: $OS"
    exit 1
    ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) arch="arm64" ;;
  x86_64)        arch="x64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Linux arm64 not supported yet
if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
  echo "Error: Linux arm64 binaries are not available yet."
  echo "You can install via npm instead: npm install -g @mindstudio-ai/local-model-tunnel"
  exit 1
fi

ARTIFACT="${BINARY_NAME}-${os}-${arch}"
DOWNLOAD_URL="${BASE_URL}/latest/${ARTIFACT}"

echo "Downloading ${BINARY_NAME} for ${os}/${arch}..."
TMPFILE=$(mktemp)
curl -fsSL "$DOWNLOAD_URL" -o "$TMPFILE"

chmod +x "$TMPFILE"

# Install to INSTALL_DIR, using sudo if needed
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
fi

echo ""
echo "Successfully installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"
echo "Run '${BINARY_NAME}' to get started."
