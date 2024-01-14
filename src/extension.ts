import * as vscode from "vscode";

import { constant, EXT_NAME } from "./constants";
import { loadSettings, SettingsInheritance } from "./inheritance";

export async function activate(context: vscode.ExtensionContext) {
  constant.context = context;

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    constant.isDev = true;
  } else if (context.extensionMode === vscode.ExtensionMode.Test) {
    constant.isTest = true;
    constant.isDev = true;
  } else {
    constant.isProd = false;
  }
  if (constant.isDev) {
    console.log("Loading extension " + EXT_NAME);
  }

  loadSettings();

  if (constant.inheritance) {
    await constant.inheritance.deactivate();
  }

  constant.inheritance = new SettingsInheritance();
  await constant.inheritance.activate(context);

  let api = {
    context,
    activate,
    deactivate,
    inheritance: constant.inheritance,
  };

  if (!constant.isTest) {
    // @ts-expect-error
    api = undefined;
  }

  return api;
}

// This method is called when your extension is deactivated
export function deactivate() {
  if (constant.inheritance) {
    constant.inheritance.deactivate();
    // @ts-expect-error
    constant.inheritance = undefined;
  }
}
