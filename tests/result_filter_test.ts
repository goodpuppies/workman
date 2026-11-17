import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, compileLibraryVirtual, compileVirtual } from "../src/compiler.ts";
import { FrontendDiagnosticError } from "../src/diagnostics.ts";
import { expectBinding } from "./type_helpers.ts";

Deno.test("Result.filter preserves the success and error types through direct calls and pipes", async () => {
  const result = await checkSource(`
    let kept = Ok(3) :> Result.filter(x => x > 0, "not positive");
    let rejected = Result.filter(Ok(0), x => x > 0, "not positive");
    let existing = Err("original") :> Result.filter((x: Real64.Real) => x > 0, "replacement");
    let converted = Some(3) :> Option.toResult("missing") :> Result.filter(x => x > 0, "not positive");
    let jsError: Result<Real64.Real, Js.Error> = Err(Js.Error("original"));
    let retained = jsError :> Result.filter(x => x > 0, Js.Error("not positive"));
    let mapped = jsError :> Result.mapErr(_ => "original") :> Result.filter(x => x > 0, "not positive");
  `);
  for (const name of ["kept", "rejected", "converted"]) {
    expectBinding(result.env, name, { type: "Result<Int32.Int, String>", vars: 0 });
  }
  for (const name of ["existing", "mapped"]) {
    expectBinding(result.env, name, { type: "Result<Real64.Real, String>", vars: 0 });
  }
  expectBinding(result.env, "retained", { type: "Result<Real64.Real, Js.Error>", vars: 0 });
});

Deno.test("Result.filter returns original passing and failed results unchanged", async () => {
  const source = `
    from js.global("Object") import unsafe { is: (a, a) -> Bool };
    let input = Ok(3);
    let kept = input :> Result.filter(x => x > 0, "rejected");
    let original = Err("original");
    let preserved = original :> Result.filter((_: Real64.Real) => Panic "predicate ran", "replacement");
    let keptIdentity = is(kept, input);
    let preservedIdentity = is(preserved, original);
  `;
  const code = await compileLibraryVirtual(
    "/test/filter.wm",
    new Map([["/test/filter.wm", source]]),
  );
  const runtime = await import(`data:text/javascript;base64,${btoa(code)}`);
  assertEquals(runtime.keptIdentity, true);
  assertEquals(runtime.preservedIdentity, true);
  assertEquals(runtime.kept, { ok: true, value: 3 });
  assertEquals(runtime.preserved, { ok: false, error: "original" });
});

Deno.test("Result.filter evaluates the predicate once per Ok and skips it for Err", async () => {
  const source = `
    let predicate = (x) => { print("predicate"); x > 0 };
    let main = () => {
      print(Ok(3) :> Result.filter(predicate, "rejected"));
      print(Result.filter(Ok(0), predicate, "rejected"));
      print(Err("original") :> Result.filter((_: Real64.Real) => Panic "predicate ran", "replacement"))
    };
  `;
  const code = await compileVirtual("/test/main.wm", new Map([["/test/main.wm", source]]));
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/main.mjs`;
    await Deno.writeTextFile(path, code);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0);
    assertEquals(new TextDecoder().decode(output.stderr), "");
    assertEquals(
      new TextDecoder().decode(output.stdout),
      "predicate\nOk(3)\npredicate\nErr(rejected)\nErr(original)\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Result.filter rejects a different error type or a non-Boolean predicate", async () => {
  for (
    const source of [
      'let input: Result<Real64.Real, Js.Error> = Err(Js.Error("original")); let output = input :> Result.filter(x => x > 0, "rejected");',
      'let output = Ok(3) :> Result.filter(x => x + 1, "rejected");',
    ]
  ) {
    await assertRejects(() => checkSource(source), FrontendDiagnosticError);
  }
});
