import * as assert from "assert";
import { after, afterEach, beforeEach } from "mocha";
import sinon from "sinon";
import { dir } from "tmp-promise";
import * as vscode from "vscode";

import pkg from "../../package.json";
import { MergeObject } from "../constants";
import { deactivate } from "../extension";
import { loadSettings, SettingsInheritance } from "../inheritance";

function setPreferences(prefs: Record<string, any>) {
  sinon.replace(
    vscode.workspace,
    "getConfiguration",
    () =>
      ({
        get: (key: string, def: any) => prefs[key] ?? def,
      } as any)
  );
}

function createThenable<T>(value: T) {
  return {
    then: async (cb: (value: T) => void) => {
      await cb(value);
    },
  };
}

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");
  after(() => {
    vscode.window.showInformationMessage("All tests done!");
  });

  const ext = vscode.extensions.getExtension(`${pkg.publisher}.${pkg.name}`);

  let context: vscode.ExtensionContext;
  let inheritance: SettingsInheritance;
  let tmpdir: string;
  let cleanup: () => Promise<void>;

  let prefs: Record<string, any>;

  let mergePrefs = [
    {
      sources: [
        {
          path: "test1.json",
          type: "json",
        },
        {
          path: "test2.json",
          type: "jsonc",
        },
        {
          path: "test3.txt",
          type: "text",
        },
      ],
      output: {
        path: "out.json",
        type: "json",
      },
    },
  ];

  beforeEach(async () => {
    const tmp = await dir({ unsafeCleanup: true });
    tmpdir = tmp.path;
    cleanup = tmp.cleanup;

    assert.ok(tmp);

    assert.ok(ext);

    const ctx = await ext!.activate();
    assert.ok(ctx);
    context = ctx.context;
    assert.ok(context);

    inheritance = new SettingsInheritance();
    assert.ok(inheritance);

    prefs = {
      targets: [
        {
          sources: [
            {
              path: "test1.json",
              type: "json",
            },
            "test2.json",
            {
              path: "test3.txt",
            },
          ],
          output: "out.json",
        },
      ],
      notifyOnMerge: true,
      notifyOnNewWorkspace: true,
      mergeOnStartup: true,
      watchSources: true,
      fetchContentCacheTime: 1000,
    };

    setPreferences(prefs);
  });

  afterEach(async () => {
    if (inheritance) {
      await inheritance.deactivate();
    }

    if (tmpdir) {
      await cleanup();
    }
    sinon.restore();
  });

  test("load merge settings", async () => {
    const s = loadSettings();

    assert.deepStrictEqual(s, { ...prefs, targets: mergePrefs });
  });

  test("merge settings json", async () => {
    const obj: MergeObject = {
      sources: [
        {
          path: "first.json",
          type: "json",
        },
        {
          path: "second.json",
          type: "jsonc",
        },
      ],
      output: {
        path: "out.json",
        type: "json",
      },
    };

    sinon.replace(vscode.workspace, "openTextDocument", ((path: string) => {
      let r: any;
      if (path === "first.json") {
        r = {
          getText: () => '{"first": 1}',
        } as any;
      } else if (path === "second.json") {
        r = {
          getText: () => `{"second": 2} // comment`,
        } as any;
      } else if (path === "out.json") {
        r = {
          getText: () => "",
          save: async () => true,
        } as any;
      } else {
        throw new Error("Unknown path");
      }

      r = {
        ...r,
        uri: vscode.Uri.file(path),
        positionAt: () => new vscode.Position(0, 0),
      };

      return createThenable(r);
    }) as any);

    const f1 = sinon.fake.resolves(true);
    const f2 = sinon.fake();
    sinon.replace(vscode.workspace, "applyEdit", f1);
    sinon.replace(vscode.WorkspaceEdit.prototype, "replace", f2);
    await inheritance.merge(obj);

    assert.ok(f1.calledOnce);
    assert.ok(f2.calledOnce);

    assert.equal(f2.firstCall.args[0].path, "/out.json");
    assert.equal(f2.firstCall.args[2], '{\n  "first": 1,\n  "second": 2}');
  });

  test("merge settings text", async () => {
    const obj: MergeObject = {
      sources: [
        {
          path: "first.json",
          type: "json",
        },
        {
          path: "second.json",
          type: "plaintext",
        },
      ],
      output: {
        path: "out.txt",
        type: "text",
      },
    };

    sinon.replace(vscode.workspace, "openTextDocument", ((path: string) => {
      let r: any;
      if (path === "first.json") {
        r = {
          getText: () => '{"first": 1}',
        } as any;
      } else if (path === "second.json") {
        r = {
          getText: () => `{"second": 2} // comment`,
        } as any;
      } else if (path === "out.txt") {
        r = {
          getText: () => "",
          save: async () => true,
        } as any;
      } else {
        throw new Error("Unknown path");
      }

      r = {
        ...r,
        uri: vscode.Uri.file(path),
        positionAt: () => new vscode.Position(0, 0),
      };

      return createThenable(r);
    }) as any);

    const f1 = sinon.fake.resolves(true);
    const f2 = sinon.fake();
    sinon.replace(vscode.workspace, "applyEdit", f1);
    sinon.replace(vscode.WorkspaceEdit.prototype, "replace", f2);
    await inheritance.merge(obj);

    assert.ok(f1.calledOnce);
    assert.ok(f2.calledOnce);

    assert.equal(f2.firstCall.args[0].path, "/out.txt");
    assert.equal(
      f2.firstCall.args[2],
      '"\\"\\"{\\"first\\":1}\\"{\\\\\\"second\\\\\\": 2} // comment\\""'
    );
  });

  test("merge settings web url", async () => {
    const obj: MergeObject = {
      sources: [
        {
          path: "https://test.com/first.json",
          type: "json",
        },
        {
          path: "second.json",
          type: "json",
        },
      ],
      output: {
        path: "out.json",
        type: "json",
      },
    };

    sinon.replace(vscode.workspace, "openTextDocument", ((path: string) => {
      let r: any;
      if (path === "second.json") {
        r = {
          getText: () => `{"second": 2} // comment`,
        } as any;
      } else if (path === "out.json") {
        r = {
          getText: () => "",
          save: async () => true,
        } as any;
      } else {
        throw new Error("Unknown path");
      }

      r = {
        ...r,
        uri: vscode.Uri.file(path),
        positionAt: () => new vscode.Position(0, 0),
      };

      return createThenable(r);
    }) as any);

    const f1 = sinon.fake.resolves(true);
    const f2 = sinon.fake();
    sinon.replace(vscode.workspace, "applyEdit", f1);
    sinon.replace(vscode.WorkspaceEdit.prototype, "replace", f2);

    sinon.replace(global, "fetch", async () => {
      return {
        text: async () => '{"web": 1}',
        ok: true,
      } as any;
    });

    await inheritance.merge(obj);

    assert.ok(f1.calledOnce);
    assert.ok(f2.calledOnce);

    assert.equal(f2.firstCall.args[0].path, "/out.json");
    assert.equal(f2.firstCall.args[2], '{\n  "web": 1,\n  "second": 2}');
  });
});
