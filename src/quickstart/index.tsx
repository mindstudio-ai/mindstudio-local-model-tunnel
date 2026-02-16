import React from 'react';
import { render } from 'ink';
import { QuickstartScreen } from './QuickstartScreen.js';
import { executeSetupAction } from './actions.js';
import { clearTerminal } from '../helpers.js';

export async function startQuickstart(): Promise<void> {
  // Loop: render Ink TUI, handle external actions, re-render
  while (true) {
    let externalAction: string | null = null;

    clearTerminal();
    const { waitUntilExit } = render(
      <QuickstartScreen
        onExternalAction={(action) => {
          externalAction = action;
        }}
      />,
    );
    await waitUntilExit();

    // If no external action was requested, user quit - break out of loop
    if (!externalAction) {
      break;
    }

    await executeSetupAction(externalAction);
  }
}

export { detectAllProviders, checkPrerequisites } from './detect.js';
export type { ProviderInfo } from './detect.js';
