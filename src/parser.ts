import peggy from "peggy";
import type { Module } from "./ast.ts";
import { offsetToLineCol, type SourceSpan } from "./source.ts";

export type Surface = "workman" | "wmsml";

let workmanParser: peggy.Parser | undefined;
let wmsmlParser: peggy.Parser | undefined;

export class ParseError extends Error {
  source: string;
  span: SourceSpan;
  filePath?: string;

  constructor(message: string, source: string, span: SourceSpan, filePath?: string) {
    super(message);
    this.name = "ParseError";
    this.source = source;
    this.span = span;
    this.filePath = filePath;
  }
}

export async function parse(source: string, surface: Surface = "workman", filePath?: string): Promise<Module> {
  const parser = await loadParser(surface);
  try {
    return parser.parse(source) as Module;
  } catch (error) {
    if (error && typeof error === "object" && "location" in error && "message" in error) {
      const err = error as { location: { start: { line: number; column: number; offset: number } }; message: string };
      const { line, column } = err.location.start;
      const offset = err.location.start.offset;
      throw new ParseError(err.message, source, {
        line,
        col: column - 1,
        start: offset,
        end: offset + 1,
      }, filePath);
    }
    throw error;
  }
}

async function loadParser(surface: Surface): Promise<peggy.Parser> {
  if (surface === "wmsml") {
    wmsmlParser ??= peggy.generate(
      await Deno.readTextFile(new URL("./grammar.wmsml.peggy", import.meta.url)),
    );
    return wmsmlParser;
  }
  workmanParser ??= peggy.generate(
    await Deno.readTextFile(new URL("./grammar.peggy", import.meta.url)),
  );
  return workmanParser;
}
