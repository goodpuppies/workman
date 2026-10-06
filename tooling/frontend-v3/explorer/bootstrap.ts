import { compileLibraryFile } from "../../../src/compiler.ts";
import type { RuntimeDocument } from "./bridge.ts";

// The existing compiler is a build dependency only. Requests run frontend-v3's WM lexer.
export async function loadLexer() {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    const source = new URL("../lexer.wm", import.meta.url).pathname;
    await Deno.writeTextFile(path, await compileLibraryFile(source));
    const { lex } = await import(new URL(`file://${path}`).href) as {
      lex: (source: string) => RuntimeDocument;
    };
    return lex;
  } finally {
    await Deno.remove(path);
  }
}
