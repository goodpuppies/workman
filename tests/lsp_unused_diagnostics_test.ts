import { assertEquals } from "@std/assert";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri, type ValidationResult } from "../src/lsp/validation.ts";

Deno.test("lsp warns for unused parameters and local bindings", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(
    main,
    `let main = (used, unused, _ignored) => {
      let local = 1;
      used
    };`,
  );

  assertEquals(await compactDiagnostics(main), [
    ["lint.unused-parameter", "unused", [1]],
    ["lint.unused-binding", "local", [1]],
  ]);
});

Deno.test("lsp warns for unused named and namespace imports", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let used = 1; let spare = 2;");
  await Deno.writeTextFile(
    main,
    `from "./lib.wm" import { used, spare as renamed };
     from "./lib.wm" import * as Unused;
     let main = () => { used };`,
  );

  assertEquals(await compactDiagnostics(main), [
    ["lint.unused-import", "renamed", [1]],
    ["lint.unused-import", "Unused", [1]],
  ]);
});

Deno.test("lsp suppresses underscore-prefixed unused imports", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let value = 1;");
  await Deno.writeTextFile(
    main,
    `from "./lib.wm" import { value as _value };
     from "./lib.wm" import * as _Lib;
     let main = () => { void };`,
  );

  assertEquals(await compactDiagnostics(main), []);
});

Deno.test("lsp does not warn for unused public nominal APIs", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(
    main,
    `record Point = { x: Number };
     type Choice = First | Second;
     let main = () => { void };`,
  );

  assertEquals(await compactDiagnostics(main), []);
});

Deno.test("lsp does not warn for an unused implicit record constructor", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(
    main,
    `let main = () => {
       record Mates = { stack: Number };
       let mates: Mates = .{ stack = 1 };
       mates.stack
     };`,
  );

  assertEquals(await compactDiagnostics(main), []);
});

Deno.test("lsp does not expose the anonymous match function's synthetic parameter", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(
    main,
    `let main = (value) => {
       value :> match {
         true => { 1 },
         false => { 0 },
       }
     };`,
  );

  assertEquals(await compactDiagnostics(main), []);
});

Deno.test("lsp warns for standard Result.debug but not a same-spelled project member", async () => {
  const dir = await Deno.makeTempDir();
  const lib = `${dir}/lib.wm`;
  const main = `${dir}/main.wm`;
  await Deno.writeTextFile(lib, "let debug = (value) => { value };");
  await Deno.writeTextFile(
    main,
    `from "./lib.wm" import * as Local;
     let main = () => { (Ok(1) :> Result.debug, Local.debug(1)) };`,
  );

  assertEquals(await compactDiagnostics(main), [
    ["lint.result-debug", "debug", undefined],
  ]);
});

async function compactDiagnostics(path: string) {
  const source = await Deno.readTextFile(path);
  const diagnostics = await diagnosticsForPath(
    await validateUri(pathToFileUri(path), new Map()),
    path,
  ) ?? [];
  return diagnostics.map((diagnostic) => [
    diagnostic.code,
    source.slice(
      offsetAt(source, diagnostic.range.start.line, diagnostic.range.start.character),
      offsetAt(source, diagnostic.range.end.line, diagnostic.range.end.character),
    ),
    diagnostic.tags,
  ]);
}

async function diagnosticsForPath(results: ValidationResult[], path: string) {
  const realPath = await Deno.realPath(path);
  return results.find((result) => result.uri === pathToFileUri(realPath))?.diagnostics;
}

function offsetAt(source: string, line: number, character: number): number {
  const lines = source.split("\n");
  return lines.slice(0, line).reduce((offset, item) => offset + item.length + 1, 0) + character;
}
