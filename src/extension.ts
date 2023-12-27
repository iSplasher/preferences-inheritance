import * as vscode from "vscode";

import { constant, EXT_NAME } from "./constants";
import { loadSettings, SettingsInheritance } from "./inheritance";

export async function activate(context: vscode.ExtensionContext) {
  console.log("Loading extension " + EXT_NAME);
  constant.context = context;

  loadSettings();

  if (constant.inheritance) {
    await constant.inheritance.deactivate();
  }

  constant.inheritance = new SettingsInheritance();
  await constant.inheritance.activate(context);

  return {
    context,
    activate,
    deactivate,
    inheritance: constant.inheritance,
  };
}

// This method is called when your extension is deactivated
export function deactivate() {
  if (constant.inheritance) {
    constant.inheritance.deactivate();
    // @ts-expect-error
    constant.inheritance = undefined;
  }
}
