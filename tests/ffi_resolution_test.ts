import { assertEquals } from "@std/assert";
import { expectBinding } from "./type_helpers.ts";
import { checkSource } from "../src/compiler.ts";
import {
  type JsReflectionProfileEvent,
  setJsReflectionProfileSink,
} from "../src/ffi/reflect/host.ts";

Deno.test("reflection resolves package declaration imports without discovering every importer", async () => {
  const directory = await Deno.makeTempDir();
  const events: JsReflectionProfileEvent[] = [];
  try {
    await Deno.mkdir(`${directory}/node_modules/fixture`, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/deno.json`,
      JSON.stringify({ nodeModulesDir: "manual" }),
    );
    await Deno.writeTextFile(
      `${directory}/package.json`,
      JSON.stringify({ dependencies: { fixture: "1.0.0" } }),
    );
    await Deno.writeTextFile(
      `${directory}/node_modules/fixture/package.json`,
      JSON.stringify({ name: "fixture", version: "1.0.0", main: "index.js", types: "index.d.ts" }),
    );
    await Deno.writeTextFile(
      `${directory}/node_modules/fixture/index.js`,
      "export function wrapped() { return { value: 42 }; }\n",
    );
    await Deno.writeTextFile(
      `${directory}/node_modules/fixture/index.d.ts`,
      'import type { Wrapped } from "./wrapped.js";\nexport declare function wrapped(): Wrapped;\n',
    );
    await Deno.writeTextFile(
      `${directory}/node_modules/fixture/wrapped.d.ts`,
      "export interface Wrapped { value: number }\n",
    );
    setJsReflectionProfileSink((event) => events.push(event));
    const checked = await checkSource(
      `
      from js.module("fixture") import { wrapped };
      let result = wrapped() :> Result.andThen((value) => { value :> .value });
    `,
      {},
      `${directory}/main.wm`,
    );
    expectBinding(checked.env, "result", { type: "Result<Number, Js.Error>", vars: 0 });
    const declarationGraphs = events.filter((event) =>
      event.kind === "deno-info" && event.specifier.includes("/node_modules/fixture/")
    );
    assertEquals(declarationGraphs.length, 0);
  } finally {
    setJsReflectionProfileSink(undefined);
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("known Deno import-map types take precedence over an installed package", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${directory}/node_modules/mapped-types`, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/node_modules/mapped-types/package.json`,
      JSON.stringify({ name: "mapped-types", version: "1.0.0", types: "index.d.ts" }),
    );
    await Deno.writeTextFile(
      `${directory}/node_modules/mapped-types/index.d.ts`,
      "export type Wrapped = { value: string };\n",
    );
    await Deno.writeTextFile(
      `${directory}/deno.json`,
      JSON.stringify({ imports: { "mapped-types": "./mapped_types.ts" } }),
    );
    await Deno.writeTextFile(
      `${directory}/mapped_types.ts`,
      "export type Wrapped = { value: number };\n",
    );
    await Deno.writeTextFile(
      `${directory}/bridge.ts`,
      'import type { Wrapped } from "mapped-types";\nexport function wrapped(): Wrapped { return { value: 42 }; }\n',
    );
    const checked = await checkSource(
      `
      from js.module("./bridge.ts") import { wrapped };
      let result = wrapped() :> Result.andThen((value) => { value :> .value });
    `,
      {},
      `${directory}/main.wm`,
    );
    expectBinding(checked.env, "result", { type: "Result<Number, Js.Error>", vars: 0 });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
