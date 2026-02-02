import React from "react";
import { render } from "ink";
import { StatusScreen } from "./StatusScreen.js";
import { ConfigScreen } from "./ConfigScreen.js";

export { StatusScreen } from "./StatusScreen.js";
export { ConfigScreen } from "./ConfigScreen.js";

export async function showStatusScreen(): Promise<void> {
  const { waitUntilExit } = render(React.createElement(StatusScreen));
  await waitUntilExit();
}

export async function showConfigScreen(): Promise<void> {
  const { waitUntilExit } = render(React.createElement(ConfigScreen));
  await waitUntilExit();
}
