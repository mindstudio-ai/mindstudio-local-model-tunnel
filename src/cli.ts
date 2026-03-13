#!/usr/bin/env node

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  if (process.argv.includes('--headless')) {
    const { startHeadless } = await import('./headless.js');
    await startHeadless({
      cwd: process.cwd(),
      devPort: getFlag('--port') ? Number(getFlag('--port')) : undefined,
      proxyPort: getFlag('--proxy-port') ? Number(getFlag('--proxy-port')) : undefined,
      bindAddress: getFlag('--bind'),
    });
  } else {
    const { startTUI } = await import('./tui/index.js');
    await startTUI();
  }
  process.exit(0);
}

main();
