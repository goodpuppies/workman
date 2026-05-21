import { assertRejects } from "@std/assert";
import { checkFile } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("imported type constructors and constructors remain available through namespace", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/option.wm`,
    "export type Option<T> = None | Some<T>; export let wrap = (x) => { Some(x) };",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./option.wm" import * as Opt;
      let value: Opt.Option<Number> = Opt.wrap(1);
      let get = match(value) => {
        Opt.Some(x) => { x },
        Opt.None => { 0 },
      };
    `,
  );

  const results = await checkFile(`${dir}/main.wm`);
  const main = results.get(await Deno.realPath(`${dir}/main.wm`));
  if (!main) throw new Error("missing main result");
  expectBinding(main.env, "get", { type: "(Option<Number>) => Number", vars: 0 });
});

Deno.test("named import allows a type and constructor to share one local spelling", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/lib.wm`,
    "export type Box<T> = | Box<T>;",
  );
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    'from "./lib.wm" import { Box }; let x: Box<Number> = Box(1);',
  );

  await checkFile(`${dir}/main.wm`);
});

Deno.test("type imports reject collisions with existing local type declarations", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/lib.wm`, "export type Box<T> = Box<T>;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      type Box = | LocalBox;
      from "./lib.wm" import { Box };
      let x = 1;
    `,
  );

  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "duplicate type import Box");
});

Deno.test("value imports reject collisions with imported constructors", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/a.wm`, "export type A = | Ctor;");
  await Deno.writeTextFile(`${dir}/b.wm`, "export type B = | Ctor;");
  await Deno.writeTextFile(
    `${dir}/main.wm`,
    `
      from "./a.wm" import { Ctor };
      from "./b.wm" import { Ctor };
      let x = Ctor;
    `,
  );

  await assertRejects(() => checkFile(`${dir}/main.wm`), Error, "duplicate value import Ctor");
});
