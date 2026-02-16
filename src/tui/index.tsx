import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { TunnelRunner } from '../runner.js';
import type { Page } from './types.js';

export async function startTUI(options?: { initialPage?: Page }): Promise<string> {
  // Clear the screen
  console.clear();

  // Create the runner instance
  const runner = new TunnelRunner();
  let exitReason = 'quit';

  // Render the TUI with stdin configured for keyboard input
  const { waitUntilExit } = render(
    <App
      runner={runner}
      initialPage={options?.initialPage}
      onExit={(reason) => {
        exitReason = reason;
      }}
    />,
    {
      exitOnCtrlC: true,
      incrementalRendering: true,
    },
  );

  // Wait for the app to exit
  await waitUntilExit();

  // Ensure clean shutdown
  runner.stop();

  return exitReason;
}
