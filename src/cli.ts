#!/usr/bin/env node
async function main() {
  const { startTUI } = await import('./tui/index.js');
  await startTUI();
  process.exit(0);
}

main();
