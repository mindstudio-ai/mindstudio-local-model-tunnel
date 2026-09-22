#!/usr/bin/env node

// The TUI is the only mode. There was a `--headless` branch here that started the Remy dev tunnel
// without an interface; the tunnel moved into @madewithremy/sandbox in September 2026, where it is a
// second bin of the C&C server that spawns it.

async function main() {
  const { startTUI } = await import('./tui/index.js');
  await startTUI();
  process.exit(0);
}

main();
