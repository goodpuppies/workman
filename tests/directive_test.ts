import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, compile, compileVirtual } from "../src/compiler.ts";
import { discoverGpuRegions, isGpuLambda } from "../src/directives.ts";
import { prepareFfiElaboration } from "../src/ffi/elab.ts";
import { hostTypingDialect } from "../src/infer/context.ts";
import { lambdaTypingDialect } from "../src/infer/expr_lambda.ts";
import { gpuTypingDialect } from "../src/infer/gpu_dialect.ts";
import { parse, ParseError } from "../src/parser.ts";

Deno.test("@gpu is lambda prologue metadata with a stable region fact", async () => {
  const module = await parse("let tint = (color) => { @gpu; color * 0.5 };");
  const decl = module.decls[0];
  if (decl.kind !== "LetDecl") throw new Error("expected let declaration");
  const value = decl.bindings[0].value;

  assertEquals(isGpuLambda(value), true);
  if (value.kind !== "Lambda") throw new Error("expected lambda");
  assertEquals(value.directives.map((directive) => directive.name), ["gpu"]);
  assertEquals(value.directives[0].node?.span, {
    line: 1,
    col: 24,
    start: 24,
    end: 29,
  });
  assertEquals(
    discoverGpuRegions(module).map((region) => ({
      id: region.id,
      bound: region.binding === decl.bindings[0],
    })),
    [{ id: 0, bound: true }],
  );
});

Deno.test("directive placement, duplication, spelling, and damage are rejected", async () => {
  await assertRejects(
    () => parse("let f = (x) => { @gpu; @gpu; x };"),
    ParseError,
    "duplicate directive @gpu",
  );
  await assertRejects(
    () => parse("let f = (x) => { @cpu; x };"),
    ParseError,
    "unknown directive @cpu",
  );
  await assertRejects(() => parse("let f = (x) => { x; @gpu; x };"), ParseError);
  await assertRejects(() => parse("@gpu;"), ParseError);
  await assertRejects(() => parse("let f = (x) => { @gpu x };"), ParseError);
});

Deno.test("GPU-only bindings and aliases stay out of current Core and JS output", async () => {
  const ordinary = await compile("let tint = (color) => { color * 0.5 };");
  const marked = await compile(
    "let tint = (color) => { @gpu; color * 0.5 }; let tintAlias = tint;",
  );

  assertEquals(ordinary.includes("const tint_"), true);
  assertEquals(marked.includes("const tint_"), false);
  assertEquals(marked.includes("const tintAlias_"), false);
  assertEquals(marked.includes("color_"), false);
});

Deno.test("unmaterialized GPU values fail closed on the host Core path", async () => {
  await assertRejects(
    () =>
      compile(`
        let tint = (color) => { @gpu; color * 0.5 };
        let host = () => { tint(1.0) };
      `),
    Error,
    "GPU-only function reference reached host Core lowering before artifact materialization",
  );
  await assertRejects(
    () => compile("let pair = (1, (color) => { @gpu; color * 0.5 });"),
    Error,
    "GPU-only lambda reached host Core lowering before artifact materialization",
  );
});

Deno.test("compiler-only GPU aliases remain compile-time-only across modules", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/shader.wm", "let shade = (value) => { @gpu; value * 0.5 };"],
    [
      "/test/main.wm",
      'from "./shader.wm" import { shade }; let selectedAlias = shade;',
    ],
  ]);
  const emitted = await compileVirtual("/test/main.wm", virtualFs);
  assertEquals(emitted.includes("const shade_"), false);
  assertEquals(emitted.includes("const selectedAlias_"), false);

  virtualFs.set(
    "/test/main.wm",
    'from "./shader.wm" import { shade }; let host = () => { shade(1.0) };',
  );
  await assertRejects(
    () => compileVirtual("/test/main.wm", virtualFs),
    Error,
    "GPU-only function reference reached host Core lowering before artifact materialization",
  );
});

Deno.test("host FFI traversal treats only @gpu lambda subtrees as opaque", async () => {
  const module = await parse(`
    let host = (uv) => { uv.x };
    let shader = (uv) => { @gpu; uv.x };
    let mixed = (uv) => {
      let shaderInner = (point) => { @gpu; point.y };
      (uv.x, shaderInner)
    };
  `);
  const ffi = prepareFfiElaboration(module);
  const bindings = ffi.module.decls.flatMap((decl) => decl.kind === "LetDecl" ? decl.bindings : []);
  const host = bindings[0].value;
  const shader = bindings[1].value;
  const mixed = bindings[2].value;
  if (host.kind !== "Lambda" || shader.kind !== "Lambda" || mixed.kind !== "Lambda") {
    throw new Error("expected lambda fixtures");
  }
  if (host.body.kind !== "Block" || shader.body.kind !== "Block" || mixed.body.kind !== "Block") {
    throw new Error("expected block fixtures");
  }

  assertEquals(host.body.result.kind, "FfiGet");
  assertEquals(shader.body.result.kind, "Var");
  assertEquals(shader.body.result.kind === "Var" ? shader.body.result.name : undefined, "uv.x");
  assertEquals(mixed.body.result.kind, "Tuple");
  if (mixed.body.result.kind !== "Tuple") throw new Error("expected mixed tuple");
  assertEquals(mixed.body.result.items[0].kind, "FfiGet");
  const innerDecl = mixed.body.items[0];
  if (innerDecl.kind !== "LetDecl") throw new Error("expected nested shader binding");
  const inner = innerDecl.bindings[0].value;
  if (inner.kind !== "Lambda" || inner.body.kind !== "Block") {
    throw new Error("expected nested shader lambda");
  }
  assertEquals(inner.body.result.kind, "Var");
  assertEquals(inner.body.result.kind === "Var" ? inner.body.result.name : undefined, "point.y");
});

Deno.test("typing dialect enters @gpu scope and ordinary nested lambdas inherit it", async () => {
  const module = await parse(`
    let host = (x) => { x };
    let shader = (x) => { @gpu; (y) => { y } };
  `);
  const bindings = module.decls.flatMap((decl) => decl.kind === "LetDecl" ? decl.bindings : []);
  const host = bindings[0].value;
  const shader = bindings[1].value;
  if (host.kind !== "Lambda" || shader.kind !== "Lambda" || shader.body.kind !== "Block") {
    throw new Error("expected dialect lambda fixtures");
  }
  const nested = shader.body.result;
  if (nested.kind !== "Lambda") throw new Error("expected nested lambda");

  assertEquals(lambdaTypingDialect(host, hostTypingDialect), hostTypingDialect);
  assertEquals(lambdaTypingDialect(shader, hostTypingDialect), gpuTypingDialect);
  assertEquals(lambdaTypingDialect(nested, gpuTypingDialect), gpuTypingDialect);
});

Deno.test("GPU dialect owns tuple-vector arithmetic without changing the host unifier", async () => {
  await checkSource("let scale = (x) => { @gpu; (x, x, x) * 0.5 };");
  await assertRejects(
    () => checkSource("let scale = (x) => { (x, x, x) * 0.5 };"),
    Error,
    "type mismatch",
  );
});
