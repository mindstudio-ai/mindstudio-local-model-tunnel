#!/usr/bin/env node
import { clearTerminal } from './helpers.js';

async function main() {
  const { startTUI } = await import('./tui/index.js');
  const { executeSetupAction } = await import('./quickstart/actions.js');
  type Page = import('./tui/types.js').Page;
  let initialPage: Page | undefined;
  while (true) {
    const result = await startTUI({ initialPage });
    initialPage = undefined;
    if (result.startsWith('setup:')) {
      const action = result.slice('setup:'.length);
      await executeSetupAction(action);
      clearTerminal();
      initialPage = 'setup';
      continue;
    }
    break;
  }
  process.exit(0);
}

main();
