import { assertEquals } from "@std/assert";
import { expectBinding } from "./type_helpers.ts";
import { analyzeRecoveredFile, checkSource } from "../src/compiler.ts";
import { prune, show, type Ty } from "../src/types.ts";

// Classes reached through properties, dictionaries, and other packages, as in
// @mapbox/vector-tile's `tile.layers.convos.feature(i).loadGeometry()`.
const shapes = `
export class Leaf { value = 1; }
export class Inner { leaf: Leaf = new Leaf(); }
export class Outer {
  inner: Inner = new Inner();
  byName: Record<string, Inner> = {};
  counts: { [key: string]: number } = {};
  mixed: Record<string, number | string | boolean> = {};
}
export function makeOuter(): Outer { return new Outer(); }
`;

async function withShapes<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/shapes.ts`, shapes);
    return await run(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

const header = `
  from js.module("./shapes.ts") import { makeOuter };
  from js.host("dict") import * as Dict;
`;

Deno.test("string-keyed TS dictionaries reflect as Js.Dict of their value type", async () => {
  await withShapes(async (directory) => {
    const checked = await checkSource(
      `${header}
      let layers = (u: Void) => makeOuter() :> Result.andThen((outer) => outer.byName);
      let counts = (u: Void) => makeOuter() :> Result.andThen((outer) => outer.counts);
      let count = (key: String) => counts(void) :> Result.map((dict) => Dict.get(dict, key));
    `,
      {},
      `${directory}/main.wm`,
    );
    expectBinding(checked.env, "layers", {
      type: "Void -> Result<Js.Dict<Inner>, Js.Error>!",
      vars: 0,
    });
    expectBinding(checked.env, "count", {
      type: "String -> Result<Option<Real64.Real!>!, Js.Error>!",
      vars: 0,
    });
  });
});

Deno.test("values TS declares as one of several Workman types read as Js.Value", async () => {
  await withShapes(async (directory) => {
    const checked = await checkSource(
      `${header}
      let mixed = (u: Void) => makeOuter() :> Result.andThen((outer) => outer.mixed);
      -- Json.assert states the expected shape; on its own it would stay polymorphic.
      let number = (value: Js.Value) => {
        let n: Result<Real64.Real, Js.Error> = value :> Json.assert;
        n
      };
      let topic = (props: Js.Dict<Js.Value>) =>
        Dict.get(props, "topic") :> Option.map(number) :> Option.getOr(Ok(0));
      let plus = (u: Void) => mixed(void) :> Result.andThen(topic) :> Result.map((n) => n + 1);
    `,
      {},
      `${directory}/main.wm`,
    );
    expectBinding(checked.env, "mixed", {
      type: "Void -> Result<Js.Dict<Js.Value>, Js.Error>!",
      vars: 0,
    });
    expectBinding(checked.env, "plus", {
      type: "Void -> Result<Real64.Real, Js.Error>!",
      vars: 0,
    });
  });
});

Deno.test("members resolve on classes reached through properties and dictionary values", async () => {
  await withShapes(async (directory) => {
    const checked = await checkSource(
      `${header}
      let chained = (u: Void) => makeOuter()
        :> Result.andThen((outer) => outer.inner)
        :> Result.andThen((inner) => inner.leaf)
        :> Result.andThen((leaf) => leaf.value);
      let throughDict = (key: String) => makeOuter()
        :> Result.andThen((outer) => outer.byName)
        :> Result.map((names) => match(Dict.get(names, key)) {
          None => 0,
          Some(inner) => Result.getOr(inner.leaf :> Result.andThen((leaf) => leaf.value), 0)
        });
    `,
      {},
      `${directory}/main.wm`,
    );
    expectBinding(checked.env, "chained", { type: "Void -> Result<Real64.Real, Js.Error>!", vars: 0 });
    expectBinding(checked.env, "throughDict", {
      type: "String -> Result<Real64.Real!, Js.Error>!",
      vars: 0,
    });
  });
});

Deno.test("recovered analysis resolves receiver members as checking does", async () => {
  await withShapes(async (directory) => {
    const path = `${directory}/main.wm`;
    await Deno.writeTextFile(
      path,
      `${header}
      let leaf = (u: Void) => makeOuter()
        :> Result.andThen((outer) => outer.inner)
        :> Result.andThen((inner) => inner.leaf);
    `,
    );
    const snapshot = await analyzeRecoveredFile(path);
    const scheme = snapshot.interfaces.get(snapshot.head)!.publicEnvironment.valEnv.get("leaf")!;
    assertEquals(show(scheme.type), "Void -> Result<Leaf, Js.Error>!");
  });
});

/** A package whose declarations import a default-exported class from another package. */
async function writePackages(directory: string) {
  const write = async (path: string, text: string) => {
    await Deno.mkdir(`${directory}/${path.slice(0, path.lastIndexOf("/"))}`, { recursive: true });
    await Deno.writeTextFile(`${directory}/${path}`, text);
  };
  await write(
    "node_modules/point-lib/package.json",
    JSON.stringify({
      name: "point-lib",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
      types: "index.d.ts",
    }),
  );
  await write("node_modules/point-lib/index.js", "export default class Point { x = 1; y = 2; }\n");
  await write(
    "node_modules/point-lib/index.d.ts",
    "declare class Point { x: number; y: number; }\nexport default Point;\n",
  );
  await write(
    "node_modules/shape-lib/package.json",
    JSON.stringify({
      name: "shape-lib",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
      types: "index.d.ts",
      dependencies: { "point-lib": "1.0.0" },
    }),
  );
  await write(
    "node_modules/shape-lib/index.js",
    'import Point from "point-lib";\nexport class Shape { rings() { return [[new Point()]]; } }\n',
  );
  await write(
    "node_modules/shape-lib/index.d.ts",
    'import Point from "point-lib";\nexport declare class Shape { rings(): Point[][]; }\n',
  );
  // A project package.json would otherwise send reflection to Deno's npm cache.
  await write(
    "package.json",
    JSON.stringify({ type: "module", dependencies: { "shape-lib": "1.0.0" } }),
  );
}

Deno.test("installed packages resolve through node_modules, including default-exported classes", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await writePackages(directory);
    const path = `${directory}/main.wm`;
    await Deno.writeTextFile(
      path,
      `
      from js.module("shape-lib") import type { Shape };
      -- Point[][] as @mapbox/vector-tile's loadGeometry returns it. (A one-level Point[] hits
      -- markdown/issues/default-export-array-element-ref-becomes-type-name.md.)
      let firstX = (shape: Shape) => shape.rings()
        :> Result.map(Js.Array.toList)
        :> Result.map(match {
          [ring, .._] => match(Js.Array.toList(ring)) { [point, .._] => Some(point), [] => None },
          [] => None
        });
      let x = (shape: Shape) => match(firstX(shape)) { Ok(Some(point)) => point.x, _ => Ok(0) };
    `,
    );
    const checked = await checkSource(await Deno.readTextFile(path), {}, path);
    expectBinding(checked.env, "x", { type: "Shape -> Result<Real64.Real, Js.Error>!", vars: 0 });
    // The default export keeps its module identity rather than being taken for a global.
    const snapshot = await analyzeRecoveredFile(path);
    const point = prune(
      snapshot.interfaces.get(snapshot.head)!.publicEnvironment.valEnv.get("firstX")!.type,
    ) as Extract<Ty, { tag: "fn" }>;
    const option = (prune(point.result) as Extract<Ty, { tag: "named" }>).args[0];
    const foreign = prune((prune(option) as Extract<Ty, { tag: "named" }>).args[0]) as Extract<
      Ty,
      { tag: "named" }
    >;
    assertEquals(foreign.foreignKey?.startsWith('nominal-type:import("'), true);
    assertEquals(foreign.foreignKey?.endsWith('/node_modules/point-lib/index").default'), true);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
