import * as assert from "assert";
import { after, afterEach, beforeEach } from "mocha";
import sinon from "sinon";
import * as vscode from "vscode";

import pkg from "../../package.json";
import { MergeObject } from "../constants";
import { deactivate } from "../extension";
import { loadSettings, SettingsInheritance } from "../inheritance";

let sinon1: sinon.SinonSandbox;

function stringToUint8Array(str: string) {
  return new TextEncoder().encode(str);
}

function setPreferences(prefs: Record<string, any>) {
  sinon1.replace(
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

function mockReadFile(
  sinon: sinon.SinonSandbox,
  files: Record<string, string>
) {
  sinon.replaceGetter(vscode.workspace, "fs", () => {
    return {
      readFile: (uri: vscode.Uri) => {
        let path = uri?.path ?? uri;
        let r: any;

        for (const [k, v] of Object.entries(files)) {
          if (path?.endsWith(k)) {
            r = v;
            break;
          }
        }

        if (!r) {
          throw new Error(`Unknown path ${path}}`);
        }

        return createThenable(stringToUint8Array(r));
      },
    } as any;
  });

  sinon.replace(vscode.workspace, "openTextDocument", ((uri: vscode.Uri) => {
    let path = uri?.path ?? uri;
    let r: any;

    for (const [k, v] of Object.entries(files)) {
      if (path?.endsWith(k)) {
        r = {
          getText: () => v,
        } as any;
        break;
      }
    }

    if (!r) {
      throw new Error(`Unknown path ${path}}`);
    }

    r = {
      ...r,
      uri: vscode.Uri.file(path),
      save: async () => true,
      positionAt: () => new vscode.Position(0, 0),
    };

    return createThenable(r);
  }) as any);
}

suite("Extension Test Suite >", () => {
  vscode.window.showInformationMessage("Start all tests.");

  // sinon.replaceGetter(vscode.workspace, "workspaceFolders", () => [
  //   {
  //     uri: vscode.Uri.file(process.cwd()),
  //     index: 0,
  //     name: "test",
  //   },
  // ]);

  sinon1 = sinon.createSandbox();
  after(() => {
    sinon1.restore();
    vscode.window.showInformationMessage("All tests done!");
  });

  const ext = vscode.extensions.getExtension(`${pkg.publisher}.${pkg.name}`);
  const extApi = (ext as any).exports;

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
    // const tmp = await dir({ unsafeCleanup: true });
    // tmpdir = tmp.path;
    // cleanup = tmp.cleanup;

    // assert.ok(tmp);

    assert.ok(ext);

    inheritance = new SettingsInheritance();
    assert.ok(inheritance);
    context = extApi.context;
    assert.ok(context);

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
    sinon1.restore();
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

    mockReadFile(sinon1, {
      "first.json": '{"first": 1}',
      "second.json": `{"second": 2} // comment`,
      "out.json": "",
    });

    const f1 = sinon1.fake.resolves(true);
    const f2 = sinon1.fake();
    sinon1.replace(vscode.workspace, "applyEdit", f1);
    sinon1.replace(vscode.WorkspaceEdit.prototype, "replace", f2);
    await inheritance.merge(obj);

    assert.ok(f1.calledOnce);
    assert.ok(f2.calledOnce);

    assert.equal(f2.firstCall.args[0].path, "/out.json");
    assert.equal(f2.firstCall.args[2], '{\n  "first": 1,\n  "second": 2\n}');
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

    mockReadFile(sinon1, {
      "first.json": '{"first": 1}',
      "second.json": `{"second": 2} // comment`,
      "out.txt": "",
    });

    const f1 = sinon1.fake.resolves(true);
    const f2 = sinon1.fake();
    sinon1.replace(vscode.workspace, "applyEdit", f1);
    sinon1.replace(vscode.WorkspaceEdit.prototype, "replace", f2);
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

    mockReadFile(sinon1, {
      "second.json": `{"second": 2} // comment`,
      "out.json": "",
    });

    const f1 = sinon1.fake.resolves(true);
    const f2 = sinon1.fake();
    sinon1.replace(vscode.workspace, "applyEdit", f1);
    sinon1.replace(vscode.WorkspaceEdit.prototype, "replace", f2);

    sinon1.replace(global, "fetch", async () => {
      return {
        text: async () => '{"web": 1}',
        ok: true,
      } as any;
    });

    await inheritance.merge(obj);

    assert.ok(f1.calledOnce);
    assert.ok(f2.calledOnce);

    assert.equal(f2.firstCall.args[0].path, "/out.json");
    assert.equal(f2.firstCall.args[2], '{\n  "web": 1,\n  "second": 2\n}');
  });

  test("merge content", async () => {
    const sinon2 = sinon.createSandbox();

    const testObjs: {
      name: string;
      sources: { path: string; type?: string; content: string }[];
      output: { path: string; type?: string; content: string };
    }[] = [
      {
        name: "simple json merge",
        sources: [
          {
            path: "1.json",
            content: '{"first": 1}',
          },
          {
            path: "2.json",
            content: `{"second": 2} // comment`,
          },
        ],
        output: {
          path: "out.json",
          content: '{\n  "first": 1,\n  "second": 2\n}',
        },
      },
    ];

    afterEach(() => {
      sinon2.restore();
    });

    for (const tObj of testObjs) {
      test(tObj.name, async () => {
        const obj: MergeObject = {
          sources: tObj.sources.map((s) => ({
            path: s.path,
            type: (tObj.output.type as any) ?? "json",
          })),
          output: {
            path: tObj.output.path,
            type: (tObj.output.type as any) ?? "json",
          },
        };

        mockReadFile(sinon2, {
          ...tObj.sources.reduce((acc, cur) => {
            acc[cur.path] = cur.content;
            return acc;
          }, {} as Record<string, string>),
          [tObj.output.path]: "",
        });

        const f1 = sinon2.fake.resolves(true);
        const f2 = sinon2.fake();
        sinon2.replace(vscode.workspace, "applyEdit", f1);
        sinon2.replace(vscode.WorkspaceEdit.prototype, "replace", f2);
        await inheritance.merge(obj);

        assert.ok(f1.calledOnce);
        assert.ok(f2.calledOnce);

        assert.equal(f2.firstCall.args[0].path, "/" + tObj.output.path);
        assert.equal(f2.firstCall.args[2], tObj.output.content);
      });
    }
  });
});
