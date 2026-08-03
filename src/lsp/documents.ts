import { normalize, resolve } from "node:path";
import { runtime } from "../io.ts";
import { fileUriToPath } from "./uri.ts";

export type TextDocument = {
  uri: string;
  path: string;
  text: string;
  version?: number;
};

export type ContentChange = {
  text: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export class DocumentStore {
  #documents = new Map<string, TextDocument>();

  open(uri: string, text: string, version?: number) {
    this.#documents.set(uri, { uri, path: fileUriToPath(uri), text, version });
  }

  change(uri: string, changes: string | ContentChange[], version?: number) {
    const current = this.#documents.get(uri);
    let text = current?.text ?? "";
    if (typeof changes === "string") {
      text = changes;
    } else {
      for (const change of changes) {
        if (!change.range) {
          text = change.text;
          continue;
        }
        const start = positionOffset(text, change.range.start);
        const end = Math.max(start, positionOffset(text, change.range.end));
        text = text.slice(0, start) + change.text + text.slice(end);
      }
    }
    this.#documents.set(uri, { uri, path: current?.path ?? fileUriToPath(uri), text, version });
  }

  close(uri: string) {
    this.#documents.delete(uri);
  }

  get(uri: string): TextDocument | undefined {
    return this.#documents.get(uri);
  }

  version(uri: string): number | undefined {
    const direct = this.#documents.get(uri)?.version;
    if (direct !== undefined) return direct;
    const path = normalize(resolve(fileUriToPath(uri)));
    for (const doc of this.#documents.values()) {
      if (normalize(resolve(doc.path)) === path) return doc.version;
      try {
        if (runtime.realPathSync(doc.path) === path) return doc.version;
      } catch {
        // Unsaved editor buffers may not exist on disk yet.
      }
    }
    return undefined;
  }

  uris(): string[] {
    return [...this.#documents.keys()];
  }

  sourceOverrides(): Map<string, string> {
    const overrides = new Map<string, string>();
    for (const doc of this.#documents.values()) {
      const path = normalize(resolve(doc.path));
      overrides.set(path, doc.text);
      try {
        overrides.set(runtime.realPathSync(path), doc.text);
      } catch {
        // Unsaved editor buffers may not exist on disk yet.
      }
    }
    return overrides;
  }
}

function positionOffset(text: string, position: { line: number; character: number }): number {
  const targetLine = Math.max(0, position.line);
  let offset = 0;
  let line = 0;
  while (line < targetLine && offset < text.length) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) return text.length;
    offset = newline + 1;
    line++;
  }
  if (line < targetLine) return text.length;
  const lineEnd = text.indexOf("\n", offset);
  return Math.min(offset + Math.max(0, position.character), lineEnd < 0 ? text.length : lineEnd);
}
