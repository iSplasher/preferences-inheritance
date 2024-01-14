import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  version: "1.60.0",
  launchArgs: ["--disable-extensions"],
  workspaceFolder: ".",
  env: {
    NODE_ENV: "test",
  },
  mocha: {
    timeout: 60000,
  },
});
