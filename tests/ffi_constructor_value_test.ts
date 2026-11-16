import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, compileLibraryFile } from "../src/compiler.ts";

const classes = `
export class Box { value: number; constructor(value: number) { this.value = value; } }
export class Tile { size: number; constructor(bytes: number, end?: number) { this.size = end ?? bytes; } }
`;

async function withClasses<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${directory}/classes.ts`, classes);
    return await run(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("an imported constructor used as a value constructs instances", async () => {
  await withClasses(async (directory) => {
    const path = `${directory}/main.wm`;
    await Deno.writeTextFile(
      path,
      `
      from js.module("./classes.ts") import { Box };
      let direct = (n: Real64.Real) => Box.new(n) :> Result.andThen((box) => box.value);
      let passed = (n: Real64.Real) => Ok(n) :> Result.andThen(Box.new) :> Result.andThen((box) => box.value);
      let bound = (n: Real64.Real) => { let make = Box.new; make(n) :> Result.andThen((box) => box.value) };
    `,
    );
    const output = `${directory}/main.mjs`;
    await Deno.writeTextFile(output, await compileLibraryFile(path));
    const library = await import(`file://${output}`);
    // Previously `passed` and `bound` read a nonexistent `new` member and returned Ok(undefined).
    for (const name of ["direct", "passed", "bound"]) {
      assertEquals(library[name](42), { ok: true, value: 42 }, name);
    }
  });
});

Deno.test("a constructor with an open arity is rejected as a first-class value", async () => {
  await withClasses(async (directory) => {
    await assertRejects(
      () =>
        checkSource(
          `
          from js.module("./classes.ts") import { Tile };
          let make = (n: Real64.Real) => Ok(n) :> Result.andThen(Tile.new);
        `,
          {},
          `${directory}/main.wm`,
        ),
      Error,
      "cannot determine JS FFI constructor arity for Tile.new as a first-class function",
    );
  });
});
