import React from 'react';
import { render } from 'ink';
import { App } from './App';
import { TunnelRunner } from '../runner';

export async function startTUI(): Promise<void> {
  // Clear the screen
  console.clear();

  // Create the runner instance
  const runner = new TunnelRunner();

  // Render the TUI with stdin configured for keyboard input
  const { waitUntilExit } = render(
    <App runner={runner} />,
    {
      exitOnCtrlC: true,
      incrementalRendering: true,
    },
  );

  // Wait for the app to exit
  await waitUntilExit();

  // Ensure clean shutdown
  runner.stop();
}
