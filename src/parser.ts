import peggy from "peggy";
import type { Module } from "./ast.ts";

let parser: peggy.Parser | undefined;

export async function parse(source: string): Promise<Module> {
  parser ??= peggy.generate(await Deno.readTextFile(new URL("./grammar.peggy", import.meta.url)));
  return parser.parse(source) as Module;
}
