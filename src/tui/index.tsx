import React from 'react';
import { render } from 'ink';
import { execFileSync, execSync } from 'node:child_process';
import { App } from './App';
import { TunnelRunner } from '../runner';
import { checkForUpdate } from '../update';
import { UpdatePrompt } from './components/UpdatePrompt';

async function promptForUpdate(
  currentVersion: string,
  latestVersion: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <UpdatePrompt
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        onChoice={(shouldUpdate) => {
          unmount();
          resolve(shouldUpdate);
        }}
      />,
      { exitOnCtrlC: true },
    );
  });
}

export async function startTUI(): Promise<void> {
  // Clear the screen
  console.clear();

  // Check for updates before launching the main app
  const update = await checkForUpdate();
  if (update) {
    const shouldUpdate = await promptForUpdate(
      update.currentVersion,
      update.latestVersion,
    );
    if (shouldUpdate) {
      console.log('\nUpdating to v' + update.latestVersion + '...\n');
      try {
        execSync('npm install -g @mindstudio-ai/local-model-tunnel@latest', {
          stdio: 'inherit',
        });
        console.log('\nRestarting...\n');
        execFileSync(process.execPath, process.argv.slice(1), {
          stdio: 'inherit',
        });
      } catch {
        console.error('\nUpdate failed. Continuing with current version.\n');
      }
      return;
    }
    console.clear();
  }

  // Create the runner instance
  const runner = new TunnelRunner();

  // Render the TUI with stdin configured for keyboard input
  const { waitUntilExit } = render(<App runner={runner} />, {
    exitOnCtrlC: true,
  });

  // Wait for the app to exit
  await waitUntilExit();

  // Ensure clean shutdown
  runner.stop();
}
