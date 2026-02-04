import React from "react";
import { render } from "ink";
import { QuickstartScreen } from "./QuickstartScreen.js";

export async function startQuickstart(): Promise<void> {
  console.clear();
  const { waitUntilExit } = render(<QuickstartScreen />);
  await waitUntilExit();
}

export { detectAllProviders, checkPrerequisites } from "./detect.js";
export type { ProviderInfo } from "./detect.js";
