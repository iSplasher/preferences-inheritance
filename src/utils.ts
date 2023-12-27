import JSON5 from 'json5';
import * as vscode from 'vscode';
import * as yaml from 'yaml';

import {
  constant,
  DocumentOutputType,
  DocumentType,
  JSONMappable,
  JSONMapType,
  JSONType,
} from './constants';

export function basename(path: string) {
  const parts = path.split(/[\/\\]/);
  return [parts[parts.length - 1], parts.slice(0, parts.length - 1).join("/")];
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): T {
  let timeoutID: NodeJS.Timeout | undefined;

  return ((...args: any[]) => {
    if (timeoutID) {
      clearTimeout(timeoutID);
    }

    timeoutID = setTimeout(() => {
      fn(...args);
    }, delay);
  }) as any;
}

export function showDocument(
  path: string,
  content?: undefined,
  type?: DocumentType
): Promise<boolean>;
export function showDocument(
  path: string | undefined,
  content: string,
  type: DocumentType
): Promise<boolean>;
export function showDocument(
  path: string | undefined,
  content: string | undefined,
  type: DocumentType | undefined
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const reject = () => resolve(false);

    const lang = type
      ? (
          {
            text: "plaintext",
          } as any
        )[type] ?? type
      : undefined;

    if (path && content) {
      vscode.workspace
        .openTextDocument({
          content,
          language: lang,
        })
        .then((doc) => {
          if (lang) {
            vscode.languages.setTextDocumentLanguage(doc, lang).then((doc) => {
              vscode.window.showTextDocument(doc);
            }, reject);
          } else {
            vscode.window.showTextDocument(doc);
          }
          resolve(true);
        }, reject);
    } else if (path) {
      vscode.workspace.openTextDocument(path).then((doc) => {
        vscode.window.showTextDocument(doc);
        resolve(true);
      }, reject);
    } else {
      resolve(false);
    }
  });
}

export function parseContent(text: string, type: DocumentType): JSONType {
  switch (type) {
    case "json":
    case "jsonc":
      return JSON5.parse(text) as JSONType;
    case "yaml":
      return yaml.parse(text) as JSONType;
    case "plaintext":
    case "text":
      return text as JSONType;
    default:
      throw new Error(`Unknown type "${type}"`);
  }
}

export function isObject(obj: any): obj is Record<any, any> {
  return obj instanceof Object && !(obj instanceof Array);
}

// like JSON.stringify but keeps the insertion order of the keys in case of a Map
export function stringifyMap(
  value: Record<string, any> | JSONMapType,
  stringify: (value: any) => string,
  opts?: {
    indent?: number;
  },
  _depth = 1
) {
  if (value instanceof Map) {
    const indent = (opts?.indent ?? 0) * _depth;
    const spaces = " ".repeat(indent);
    let out = "{";
    let i = 0;
    for (const [k, v] of value.entries()) {
      const innerValue =
        v instanceof Map
          ? stringifyMap(v, stringify, opts, _depth + 1)
          : stringify(v);

      out += `\n${spaces}"${k}": ${innerValue}`;

      i++;
      if (i < value.size) {
        out += ",";
      }
    }
    out += "}";
    return out;
  } else {
    return stringify(value);
  }
}

export function stringifyContent(
  value: string | JSONType | JSONMappable,
  type: DocumentOutputType
) {
  const indent = constant.JSONIndent;

  switch (type) {
    case "plaintext":
    case "text":
      return JSON.stringify(value);
    case "json":
    case "yaml": {
      if (value instanceof Map) {
        switch (type) {
          case "json":
            return stringifyMap(value, (v) => JSON.stringify(v, null, indent), {
              indent,
            });
          case "yaml":
            return stringifyMap(value, (v) => yaml.stringify(v, { indent }), {
              indent,
            });
        }
      } else {
        switch (type) {
          case "json":
            return JSON.stringify(value, null, indent);
          case "yaml":
            return yaml.stringify(value, { indent });
        }
      }
    }
    default:
      throw new Error(`Unknown type "${type}"`);
  }
}

export function camelCase(str: string) {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

export function isWebUrl(url: string | URL) {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    if (u.protocol === "http:" || u.protocol === "https:") {
      return true;
    }
  } catch (e) {}
  return false;
}

export function downloadDocument(url: URL, clean = true) {
  if (!isWebUrl(url.toString())) {
    throw new Error(`Invalid URL "${url}"`);
  }

  return fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(
        `Failed to download document from "${url}":\n${res.status} - ${res.statusText}`
      );
    }

    return res.text().then((text) => {
      if (clean) {
        return text.trim();
      }
      return text;
    });
  });
}
