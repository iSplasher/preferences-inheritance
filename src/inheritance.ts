import * as vscode from "vscode";

import {
  constant,
  documentOutputType,
  documentType,
  EXT_NAME_HUMAN,
  JSONMappable,
  JSONType,
  MergeObject,
  MergeOutput,
  MergeSource,
  NoWorkspace,
  ValueOf,
} from "./constants";
import { deactivate } from "./extension";
import {
  basename,
  CONFIG_SECTION,
  debounce,
  downloadDocument,
  expandPath,
  fileURI,
  formatInputPath,
  getSettingsKey,
  getSettingsKeys,
  isDeepEqual,
  isObject,
  isWebUrl,
  logFmt,
  parseContent,
  popForEach,
  showDocument,
  stringifyContent,
  stringifyMap,
} from "./utils";

function showError(msg: string, e?: any, warning?: boolean) {
  const cb = warning
    ? vscode.window.showWarningMessage
    : vscode.window.showErrorMessage;
  if (e) {
    cb(`${msg}`, {});
  } else {
    cb(`${msg}: ${e?.message ?? e}`);
  }
  console.error(`${EXT_NAME_HUMAN}: ${msg}`);
  if (e) {
    console.error(e);
  }
}

export function loadSettings() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const defaultOutputType = "json" as const;
  const defaultSourceType = "jsonc" as const;

  function getType<T>(
    t: any,
    path: string,
    def: T,
    types: typeof documentType | typeof documentOutputType
  ): T {
    if (t) {
      return t as T;
    }

    if (path) {
      const ext = path.split(".").pop();
      if (types.includes(ext as any)) {
        return ext as T;
      }
      if (ext === "yml") {
        return "yaml" as T;
      }
      if (ext === "txt") {
        return "text" as T;
      }
    }

    return def;
  }

  function validateMergePrefs(value: any): MergeObject[] {
    const env = process.env;
    const workspaceFolder =
      vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? "";

    const fmtPath = (p: string) =>
      formatInputPath(
        expandPath(p, {
          env,
          workspaceFolder,
        })
      );

    let r: MergeObject[] = [];

    if (!Array.isArray(value)) {
      showError("Invalid merge settings, expected array", value);
      return r;
    }

    for (const v of value) {
      if (!isObject(v)) {
        showError("Invalid merge settings, expected object", v);
        continue;
      }

      const sources: MergeSource[] = [];
      for (const s of v?.sources ?? []) {
        if (!s) {
          continue;
        }
        if (typeof s === "string") {
          sources.push({
            path: fmtPath(s),
            type: defaultSourceType,
          });
        } else if (s?.path && typeof s.path === "string") {
          sources.push({
            path: fmtPath(s.path),
            type: getType(s.type, s.path, defaultSourceType, documentType),
          });
        }
      }

      let oPath = typeof v?.output === "string" ? v?.output : v?.output?.path;

      if (oPath && sources.length) {
        oPath = fmtPath(oPath);
        r.push({
          sources,
          output: {
            path: oPath,
            type: getType(
              v?.output?.type,
              oPath,
              defaultOutputType,
              documentOutputType
            ),
          },
        });
      }
    }

    return r;
  }

  const s = {
    targets: validateMergePrefs(
      cfg.get<MergeObject[]>(getSettingsKey("targets"), [])
    ),
    notifyOnMerge: cfg.get<boolean>(getSettingsKey("notifyOnMerge"), false),
    notifyOnNewWorkspace: cfg.get<boolean>(
      getSettingsKey("notifyOnNewWorkspace"),
      true
    ),
    mergeOnStartup: cfg.get<boolean>(getSettingsKey("mergeOnStartup"), true),
    fetchContentCacheTime: cfg.get<number>(
      getSettingsKey("fetchContentCacheTime"),
      60 * 5 // 5 minutes
    ),
    watchSources: cfg.get<boolean>(getSettingsKey("watchSources"), true),
  };

  constant.settings = s;

  return s;
}

export function getWorkspaceState<
  K extends keyof ValueOf<typeof constant.workspaceState>,
  T extends ValueOf<typeof constant.workspaceState>[K]
>(key: K, defaultValue?: T) {
  const rootPath =
    vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? NoWorkspace;
  if (rootPath) {
    if (!constant.workspaceState[rootPath]) {
      constant.workspaceState[rootPath] = {
        notified: false,
      };
    }
    return constant.workspaceState[rootPath][key] ?? defaultValue;
  }
  return defaultValue;
}

export function setWorkspaceState<
  K extends keyof ValueOf<typeof constant.workspaceState>,
  T extends ValueOf<typeof constant.workspaceState>[K]
>(key: K, value: T) {
  const rootPath =
    vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? NoWorkspace;
  if (rootPath) {
    getWorkspaceState(key);
    constant.workspaceState[rootPath][key] = value;
  }
  return value;
}

export class SettingsInheritance {
  private disposables: {
    commands: vscode.Disposable[];
    other: vscode.Disposable[];
    watch: vscode.Disposable[];
    configChanged: vscode.Disposable | undefined;
    workspaceChanged: vscode.Disposable | undefined;
  } = {
    commands: [],
    other: [],
    watch: [],
    configChanged: undefined,
    workspaceChanged: undefined,
  };

  _restarting = false;

  private addDisposable(
    k: keyof typeof this.disposables,
    d: vscode.Disposable
  ) {
    if (Array.isArray(this.disposables[k])) {
      (this.disposables[k] as vscode.Disposable[]).push(d);
    } else {
      (this.disposables[k] as vscode.Disposable) = d;
    }
    constant.context.subscriptions.push(d);
  }

  private async saveOutput(path: string, content: string) {
    return new Promise<boolean>((resolve, reject) => {
      vscode.workspace.openTextDocument(path).then(async (doc) => {
        let changed = false;
        if (doc.getText() !== content) {
          changed = true;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            doc.uri,
            new vscode.Range(
              doc.positionAt(0),
              doc.positionAt(doc.getText().length)
            ),
            content
          );
          if (!(await vscode.workspace.applyEdit(edit))) {
            return reject("Failed to apply edit");
          }
          if (!(await doc.save())) {
            return reject("Failed to save output document");
          }
        }
        return resolve(changed);
      }, reject);
    });
  }

  private _mergeObject(
    obj: JSONMappable,
    source: JSONMappable,
    opts?: {
      mergeObjectDepth?: number;
    }
  ) {
    function setValue(k: string, v: any) {
      if (obj instanceof Map) {
        obj.set(k, v);
      } else {
        obj[k] = v;
      }
    }

    for (const [key, value] of source instanceof Map
      ? source.entries()
      : Object.entries(source)) {
      if (opts?.mergeObjectDepth && (value instanceof Map || isObject(value))) {
        for (const [k, v] of value instanceof Map
          ? value.entries()
          : Object.entries(value)) {
          const sourceValue = obj instanceof Map ? obj.get(key) : obj[key];

          const vIsObj = v instanceof Map || isObject(v);
          const sourceValueIsObj =
            sourceValue instanceof Map || isObject(sourceValue);

          if (vIsObj) {
            setValue(
              k,
              this._mergeObject(
                sourceValueIsObj ? (sourceValue as JSONMappable) : new Map(),
                v as JSONMappable,
                {
                  mergeObjectDepth: opts.mergeObjectDepth - 1,
                }
              )
            );
          } else {
            setValue(k, v);
          }
        }
      } else {
        setValue(key, value);
      }
    }
    return obj;
  }

  mergeObject(obj: JSONMappable, ...sources: JSONMappable[]) {
    for (const source of sources) {
      obj = this._mergeObject(obj, source, {
        mergeObjectDepth: 1, // TODO: configurable?
      });
    }
    return obj;
  }

  mergeContent(content: Map<MergeSource, string>, output: MergeOutput) {
    let prefsType = "map" as "map" | "text";

    if (["plaintext", "text"].includes(output.type)) {
      prefsType = "text";
    }

    let prefs: JSONType | JSONMappable = prefsType === "text" ? "" : new Map();

    // Map remembers the original insertion order of the keys so this is ok
    for (const [source, txt] of content.entries()) {
      const v = parseContent(txt, source.type);

      switch (source.type) {
        case "plaintext":
        case "text": {
          if (prefsType !== "text") {
            prefs =
              prefs instanceof Map && !prefs.size ? "" : JSON.stringify(prefs);
            const e =
              "Source with type='text' found when output has type='json'. Concatenating merge strategy will be used.";
            console.warn(logFmt(e));
            showError(e, undefined, true);
          }
          prefsType = "text";
          prefs += JSON.stringify(v);
          break;
        }
        default: {
          if (prefsType === "text" || v === null) {
            prefs =
              prefs instanceof Map || isObject(prefs)
                ? stringifyMap(
                    prefs,
                    (v) => JSON.stringify(prefs, null, constant.JSONIndent),
                    { indent: constant.JSONIndent }
                  )
                : JSON.stringify(prefs);
            prefs += JSON.stringify(v);
          } else {
            if (v instanceof Map || isObject(v)) {
              prefs = this.mergeObject(
                prefs as JSONMappable,
                v as JSONMappable
              );
            } else {
              throw new Error(`Expected object. Cannot merge ${typeof prefs}`);
            }
          }
        }
      }
    }

    // double newlines
    "hello \n".replace(/\n/g, "\n\n");

    return stringifyContent(prefs, output.type);
  }

  async merge(obj: MergeObject) {
    let changed = false;
    const content: Map<MergeSource, string> = new Map();
    let outputErr: string = "";

    try {
      for (const source of obj.sources) {
        if (isWebUrl(source.path)) {
          const fetchTime = constant.settings.fetchContentCacheTime * 1000;
          if (
            !constant.contentCache[source.path] ||
            Date.now() - constant.lastContentFetchTime > fetchTime
          ) {
            const empty = Symbol();
            try {
              constant.contentCache[source.path] = await downloadDocument(
                new URL(source.path)
              );

              if (!constant.contentCache[source.path]) {
                throw empty;
              }
              constant.lastContentFetchTime = Date.now();
            } catch (e) {
              if (e === empty) {
                console.warn(logFmt("Empty content from URL"), source.path);
                constant.lastContentFetchTime += 1000;
              } else {
                content.set(
                  source,
                  `<${(e as { message?: string })?.message ?? e}>`
                );
                constant.lastContentFetchTime += fetchTime * 0.25;
                throw e;
              }
            }
          }

          content.set(source, constant.contentCache[source.path]);
        } else {
          const fileContent = await vscode.workspace.fs.readFile(
            fileURI(source.path)
          );

          const txt = new TextDecoder().decode(fileContent).trim();

          if (txt) {
            content.set(source, txt);
          } else {
            console.warn(logFmt("Empty content from file"), source.path);
          }
        }
      }

      try {
        const output = this.mergeContent(content, obj.output);
        changed = await this.saveOutput(obj.output.path, output);
      } catch (e) {
        outputErr = `<${(e as { message?: string })?.message ?? e}>`;
        throw e;
      }
    } catch (e) {
      vscode.window
        .showErrorMessage(
          `Failed to merge settings. Open Developer Tools for more details."\n${e}`,
          "Show sources & output",
          "Show only output"
        )
        .then((value) => {
          switch (value) {
            case "Show sources & output": {
              for (const source of obj.sources) {
                const v = content.get(source);
                if (v) {
                  showDocument(source.path, v, source.type);
                }
              }

              showDocument(obj.output.path, outputErr, obj.output.type);
              break;
            }
            case "Show only output":
              showDocument(obj.output.path, outputErr, obj.output.type);
              break;
          }
        });
      console.error("Failed to merge settings");
      console.error(e);
    }

    let notified = false;
    if (constant.settings.notifyOnNewWorkspace) {
      if (!getWorkspaceState("notified", false)) {
        vscode.window.showInformationMessage(
          `${EXT_NAME_HUMAN} is now active for this workspace.`
        );
        notified = true;
        setWorkspaceState("notified", true);
      }
    }

    if (!notified && changed) {
      const txt =
        "Settings were merged. Please reload VS Code to apply changes.";

      if (constant.settings.notifyOnMerge) {
        vscode.window.showInformationMessage(txt, "Reload").then((value) => {
          if (value === "Reload") {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        });
      } else {
        vscode.window.setStatusBarMessage(txt, 5000);
      }
    }
  }

  watch(obj: MergeObject) {
    const sources = [...obj.sources];

    const cb = debounce(() => {
      this.merge(obj);
    }, 1000);

    for (const source of sources) {
      if (isWebUrl(source.path)) {
        cb();
      } else {
        vscode.workspace.fs.stat(fileURI(source.path)).then(
          (stat) => {
            const [name, head] = basename(source.path);

            const p = new vscode.RelativePattern(fileURI(head), name);

            const watcher = vscode.workspace.createFileSystemWatcher(
              p,
              false,
              false,
              false
            );

            this.addDisposable("watch", watcher.onDidChange(cb));
            this.addDisposable("watch", watcher.onDidCreate(cb));
            this.addDisposable("watch", watcher);
          },
          (e) => {
            showError(`Failed to watch merge source file ${source.path}`, e);
          }
        );
      }
    }
  }

  async start() {
    loadSettings();
    popForEach(this.disposables.watch, (d) => d.dispose());
    for (const obj of constant.settings.targets) {
      await this.merge(obj);
      if (constant.settings.watchSources) {
        this.watch(obj);
      }
    }
  }

  async activate(context: vscode.ExtensionContext) {
    constant.context = context;
    this.dispose();

    const cmdKey = `${CONFIG_SECTION}.mergePreferences`;
    this.addDisposable(
      "commands",
      vscode.commands.registerCommand(cmdKey, () => {
        this.start();
      })
    );

    if (constant.settings.mergeOnStartup || this._restarting) {
      await this.start();
    }

    this.registerChangedConfig();
    this.registerWorkspaceChanged();
  }

  registerWorkspaceChanged() {
    if (!this.disposables.workspaceChanged) {
      this.disposables.workspaceChanged =
        vscode.workspace.onDidChangeWorkspaceFolders((e) => {
          this.restart();
        });
    }
  }

  registerChangedConfig() {
    if (!this.disposables.configChanged) {
      this.disposables.configChanged =
        vscode.workspace.onDidChangeConfiguration(async (e) => {
          if (e.affectsConfiguration(CONFIG_SECTION)) {
            const old = constant.settings;
            loadSettings();
            if (
              getSettingsKeys("targets").some((k) =>
                isDeepEqual(
                  old[k] as JSONType,
                  constant.settings[k] as JSONType
                )
              )
            ) {
              this.restart();
            }
          }
        });
    }
  }

  async _restart() {
    this.deactivate();
    await this.activate(constant.context);
    console.log(logFmt("Restarted"));
  }

  restart = debounce(this._restart, 1000);

  deactivate() {
    this.dispose();
  }

  dispose() {
    popForEach(this.disposables.commands, (d) => d.dispose());
    popForEach(this.disposables.other, (d) => d.dispose());
    popForEach(this.disposables.watch, (d) => d.dispose());
    this.disposables.configChanged?.dispose();
    this.disposables.configChanged = undefined;
    this.disposables.workspaceChanged?.dispose();
    this.disposables.workspaceChanged = undefined;
  }
}
