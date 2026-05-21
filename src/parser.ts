import peggy from "peggy";
import type { Module } from "./ast.ts";

export type Surface = "workman" | "wmsml";

let workmanParser: peggy.Parser | undefined;
let wmsmlParser: peggy.Parser | undefined;

export async function parse(source: string, surface: Surface = "workman"): Promise<Module> {
  const parser = await loadParser(surface);
  return parser.parse(source) as Module;
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
