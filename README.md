# Preferences Inheritance

VS Code extension that allows sharing common preferences across profiles, workspaces, and projects through inheritance. It even allows fetching preferences from the web. Motivated by this [VS Code issue](https://github.com/microsoft/vscode/issues/188612)

## Features

More precisely, this extension merges the given source of config files into a final config file that can be placed wherever you want.

### Example Scenario

**Config:**
```jsonc
# .vscode/settings.json
{
    "targets": [
        {
            "sources": [
                "https://url.to/online/root/settings.json", // can fetch from remote url
                {
                    "path": "path/to/local/base/settings.json", // verbose, specify type
                    "type": "jsonc"
                },
                "path/to/c++/project/settings.json" // simple path, type inferred from file ext
            ],
            "output": "path/to/my/profile/workspace/.vscode/settings.json"
        }
    ],
    "notifyOnMerge": true,
    "mergeOnStartup": true,
    "watchSources": true
}
```

This config can be placed at the workspace, .vscode, or profile level. The extension will merge the sources into a final output config that gets applied. This way, I keep my setting files DRY and can reuse or combine them across multiple projects and environments however I want.


## Requirements

The extension won't do anything before specifying `preferencesInheritance.targets`.

## Extension Settings

All paths supports the following variables: `${workspaceFolder}`, `${env.some_environment_variable}`

This extension contributes the following settings:

* `preferencesInheritance.targets`:

    Example:

    `output: { path: "out.json", type: "json" }` // for output, type can be [json, text, yaml]

    or, just a string, will derive type from extension or default to json

    `output: "out.json"`

    `sources: [{ path: "test1.json", type: "jsonc" }, ...]` // for source, type can be [json, jsonc, text, yaml]
    or, just a string, content is merged (or concatenated in case of `type=text`) first to last.

    `sources: ["test1.json", { path: "test2.txt", type: "text"}, ...]`

* `preferencesInheritance.mergeOnStartup`: Merge preferences on startup.
* `preferencesInheritance.notifyOnMerge`: Notify when preferences are merged.
* `preferencesInheritance.notifyOnNewWorkspace`: Notify about merges being active (if list of merge sources is non-empty) when a new workspace is opened.
* `preferencesInheritance.watchSources`: Watch sources for changes and merge on change.
* `preferencesInheritance.fetchContentCacheTime`: Time in seconds to cache fetched web content. Default is 60 * 5 seconds.

## Release Notes


See [CHANGELOG.md](./CHANGELOG.md)