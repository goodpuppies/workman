import { normalize, resolve } from "node:path";
import { runtime } from "../io.ts";
import { fileUriToPath } from "./uri.ts";

export type TextDocument = {
  uri: string;
  path: string;
  text: string;
  version?: number;
};

export class DocumentStore {
  #documents = new Map<string, TextDocument>();

  open(uri: string, text: string, version?: number) {
    this.#documents.set(uri, { uri, path: fileUriToPath(uri), text, version });
  }

  change(uri: string, text: string, version?: number) {
    const current = this.#documents.get(uri);
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
