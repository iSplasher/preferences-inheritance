import * as vscode from 'vscode';

import type { SettingsInheritance } from "./inheritance";

export type ValueOf<T> = T[keyof T];
export type JSONType =
  | string
  | number
  | boolean
  | null
  | JSONType[]
  | { [key: string]: JSONType };

export type JSONMapType = Map<string, JSONType | JSONMapType>;

export type JSONMappable = Record<string, JSONType | JSONMapType> | JSONMapType;

export interface Settings {
  targets: MergeObject[];
  notifyOnMerge: boolean;
  notifyOnNewWorkspace: boolean;
  mergeOnStartup: boolean;
  watchSources: boolean;
  fetchContentCacheTime: number;
}

export type SettingsKey = keyof Settings;

export const documentType = [
  "jsonc",
  "text",
  "plaintext",
  "json",
  "yaml",
] as const;
export type DocumentType = (typeof documentType)[number];
export const documentOutputType = [
  "text",
  "plaintext",
  "json",
  "yaml",
] as const;
export type DocumentOutputType = (typeof documentOutputType)[number];

export interface MergeSource {
  path: string;
  type: DocumentType;
}

export interface MergeOutput {
  path: string;
  type: DocumentOutputType;
}

export interface MergeObject {
  sources: MergeSource[];
  output: MergeOutput;
}

export const EXT_NAME = "preferences-inheritance";
export const EXT_NAME_HUMAN = "Preferences Inheritance";

export const NoWorkspace = Symbol();
export type WorkspaceRootPath = string | typeof NoWorkspace;

export class constant {
  static inheritance: SettingsInheritance;
  static context: vscode.ExtensionContext;
  static settings: Settings = {} as Settings;

  static contentCache: Record<string, string> = {};
  static lastContentFetchTime = 0;
  static JSONIndent = 2;

  static readonly workspaceState: Record<
    WorkspaceRootPath,
    {
      notified: boolean;
    }
  > = {} as any;

  static isTest: boolean;
  static isDev: boolean;
  static isProd: boolean;
}
