import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { checkSource, compileLibraryVirtual } from "../src/compiler.ts";
import { formatDiagnostic, FrontendDiagnosticError } from "../src/diagnostics.ts";

Deno.test("basic pipe to function", async () => {
  await checkSource(`
    let double = (x) => { x * 2 };
    let result = 42 :> double;
  `);
});

Deno.test("chained pipe operators", async () => {
  await checkSource(`
    let double = (x) => { x * 2 };
    let add = (x, y) => { x + y };
    let print = (x) => { x };
    let result = 42 :> double :> add(10) :> print;
  `);
});

Deno.test("pipe with multi-argument function", async () => {
  await checkSource(`
    let add = (x, y) => { x + y };
    let result = 10 :> add(5);
  `);
});

Deno.test("pipe with tuple for multiple arguments", async () => {
  await checkSource(`
    let add = (x, y) => { x + y };
    let result = (10, 5) :> add;
  `);
});

Deno.test("pipe applies to functions produced by nested applications", async () => {
  const source = `
    let makeTransform = (offset) => {
      (transform) => {
        (value) => {
          transform(value + offset)
        }
      }
    };

    let withoutPlaceholder = 40 :> makeTransform 1 (value) => { value + 1 };
    let withPlaceholder = 40 :> makeTransform 1 (value) => { value + 1 }();

    let add = (left, right) => { left + right };
    let ordinaryPipe = 10 :> add(5);
  `;
  const js = await compileLibraryVirtual(
    "/test/library.wm",
    new Map([
      ["/test/library.wm", source],
    ]),
  );
  const module = await importGenerated(js);

  assertEquals(module.withoutPlaceholder, 42);
  assertEquals(module.withPlaceholder, 42);
  assertEquals(module.ordinaryPipe, 15);
});

Deno.test("pipe preserves FFI receiver reflection in inline functions", async () => {
  await checkSource(`
    let text = 16 :> ((byte: Number) => { byte.toString(16) });
  `);
});

Deno.test("pipe member segments elaborate to FFI receiver calls", async () => {
  await checkSource(`
    let hex = (byte: Number) => {
      byte :> .toString(16)
    };
    let joined = (items: Js.Array<String>) => {
      items :> .join("")
    };
  `);
});

Deno.test("pipe member chains continue through HM-typed primitive results", async () => {
  await checkSource(`
    let try = (result) => {
      match(result) {
        Ok(value) => { value },
        Err(_) => { Panic("ffi") },
      }
    };
    let hex = (byte: Number) => {
      let text: String = byte :> .toString(16) :> try;
      text :> .padStart(2, "0")
    };
  `);
});

Deno.test("pipe task error mismatch points at both origin slots", async () => {
  const source = `
      let scanAll: Void -> Task<Void, Js.Error> = () => {
        void :> Task.succeed
      };
      let left: Result<Number, String> = Err("cli");
      let bad = left
        :> Task.fromResult
        :> Task.andThen((n) => {
          scanAll()
        });
    `;
  const error = await assertRejects(
    () => checkSource(source),
    FrontendDiagnosticError,
  );
  const rendered = formatDiagnostic(error.diagnostic, "task-pipe.wm", source);
  assertStringIncludes(
    rendered,
    "type error: pipe sides can't be both:",
  );
  assertStringIncludes(rendered, "let bad = {..}");
  assertStringIncludes(rendered, ": String");
  assertStringIncludes(rendered, ": Js.Error");
  assertStringIncludes(rendered, "let annotation: Js.Error");
  assertStringIncludes(rendered, "Err call result: String");
});

async function importGenerated(source: string): Promise<Record<string, unknown>> {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/pipe.mjs`;
  await Deno.writeTextFile(path, source);
  try {
    return await import(`${new URL(`file://${path}`).href}?cache=${crypto.randomUUID()}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
