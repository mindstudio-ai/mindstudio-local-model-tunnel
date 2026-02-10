import React from "react";
import { render } from "ink";
import { StatusScreen } from "./StatusScreen.js";
import { ConfigScreen } from "./ConfigScreen.js";
import { HomeScreen } from "./HomeScreen.js";
import { ModelsScreen } from "./ModelsScreen.js";

export { StatusScreen } from "./StatusScreen.js";
export { ConfigScreen } from "./ConfigScreen.js";
export { HomeScreen } from "./HomeScreen.js";
export { ModelsScreen } from "./ModelsScreen.js";

function clearTerminal() {
  process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
}

export async function showStatusScreen(): Promise<void> {
  clearTerminal();
  const { waitUntilExit } = render(React.createElement(StatusScreen));
  await waitUntilExit();
}

export async function showConfigScreen(): Promise<void> {
  clearTerminal();
  const { waitUntilExit } = render(React.createElement(ConfigScreen));
  await waitUntilExit();
}

export async function showModelsScreen(): Promise<void> {
  clearTerminal();
  const { waitUntilExit } = render(React.createElement(ModelsScreen));
  await waitUntilExit();
}

export async function showHomeScreen(): Promise<string | null> {
  clearTerminal();
  const { waitUntilExit } = render(React.createElement(HomeScreen));
  await waitUntilExit();
  // Return the next command to run, if any
  const nextCommand = process.env.MINDSTUDIO_NEXT_COMMAND;
  delete process.env.MINDSTUDIO_NEXT_COMMAND;
  return nextCommand || null;
}
