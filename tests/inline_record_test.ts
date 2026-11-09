import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  checkSource,
  checkVirtual,
  compile,
  compileVirtual,
  coreVirtual,
} from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { formatFrontendV2Source } from "../src/frontend_v2_formatter.ts";
import { importProgram } from "./import_program.ts";
import { moduleId } from "../src/module_id.ts";
import { expectBinding } from "./type_helpers.ts";

const addSource = "let add = (r: AddI{a:I32, b:I32}): AddRes{result:I32} => {.{result=r.a+r.b}};";

Deno.test("inline nominal records declare parameter and return types", async () => {
  const result = await checkSource(`${addSource}
    let input = AddI{ a = 2, b = 3 };
    let output = add(input);
    let total = output.result;
    let constructed = AddRes(5);
  `);
  expectBinding(result.env, "input", { type: "AddI", vars: 0 });
  expectBinding(result.env, "output", { type: "AddRes", vars: 0 });
  expectBinding(result.env, "total", { type: "I32", vars: 0 });
  expectBinding(result.env, "constructed", { type: "AddRes", vars: 0 });
  const module = await parseCompilerModule(addSource);
  assertEquals(module.decls.map((decl) => decl.kind), ["RecordDecl", "RecordDecl", "LetDecl"]);
});

Deno.test("inline nominal records compile and execute with both constructor forms", async () => {
  const javaScript = await compile(`${addSource}
    let main = () => {
      print(add(AddI(2, 3)).result);
      print(add(AddI{ a = 4, b = 5 }).result)
    };
  `);
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await importProgram(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["5", "9"]);
});

Deno.test("inline nominal records support nested fields, aliases, and generic declarations", async () => {
  const result = await checkSource(`
    let outer: Outer{ inner: Inner{ value: I32 } } = .{ inner = .{ value = 7 } };
    let value = outer.inner.value;
    type EmptyAlias = Empty{};
    let empty: EmptyAlias = Empty();
    let identity = (box: Box<t>{ value: t }) => { box.value };
    let number = identity(Box(42));
    let text = identity(Box("hello"));
    record Container = { payload: Payload{ enabled: Bool } };
    let container = Container(Payload(true));
  `);
  expectBinding(result.env, "outer", { type: "Outer", vars: 0 });
  expectBinding(result.env, "value", { type: "I32", vars: 0 });
  expectBinding(result.env, "empty", { type: "Empty", vars: 0 });
  expectBinding(result.env, "number", { type: "Number", vars: 0 });
  expectBinding(result.env, "text", { type: "String", vars: 0 });
  expectBinding(result.env, "container", { type: "Container", vars: 0 });
});

Deno.test("inline record definitions stay in their containing block", async () => {
  await checkSource(`
    let first = () => {
      let read = (r: Local{ value: I32 }) => { r.value };
      read(Local(3))
    };
    let second = () => {
      let read = (r: Local{ value: String }) => { r.value };
      read(Local("hello"))
    };
    let result = () => { ((r: ResultLocal{ value: Bool }) => { r.value })(.{ value = true }) };
    let enabled = result();
  `);
  await assertRejects(
    () =>
      checkSource(
        "let f = () => { let r: Hidden{ x: I32 } = .{ x = 1 }; r.x }; let bad = Hidden(2);",
      ),
    Error,
    "unknown name Hidden",
  );
});

Deno.test("inline records retain nominal identity and field validation", async () => {
  await assertRejects(
    () =>
      checkSource(
        "let f = (x: First{ value: I32 }) => { x }; let y: Second{ value: I32 } = .{ value = 1 }; f(y);",
      ),
  );
  await assertRejects(
    () => checkSource("let f = (x: Duplicate{ value: I32, value: Bool }) => { x };"),
    Error,
    "duplicate record field",
  );
  await assertRejects(
    () => checkSource("let f = (x: Repeated{ a: I32 }, y: Repeated{ b: Bool }) => { x };"),
    Error,
    "does not match the existing record",
  );
  await assertRejects(
    () => checkSource("let x: Checked{ value: I32 } = .{ value = true };"),
  );
});

Deno.test("module-level inline records export their types and constructors", async () => {
  await checkVirtual(
    "/test/main.wm",
    new Map([
      ["/test/add.wm", addSource],
      [
        "/test/main.wm",
        `
      from "./add.wm" import { add, AddI, AddRes };
      let input: AddI = AddI(2, 3);
      let output: AddRes = add(input);
      let total: I32 = output.result;
    `,
      ],
    ]),
  );
});

Deno.test("formatter preserves inline record declarations and is idempotent", async () => {
  for (
    const source of [
      addSource,
      "let x:Outer{inner:Inner{value:I32,},}=.{inner=.{value=1}};",
      "let id=(x:Box<t>{value:t})=>x; type Alias=Empty{};",
      "let f=(x:Input{/* field */ value:I32}):Output{result:I32}=>.{result=x.value};",
    ]
  ) {
    for (const fix of [false, true]) {
      const formatted = await formatFrontendV2Source(source, "<inline-record>", fix);
      assertStringIncludes(formatted, "{");
      await checkSource(formatted);
      assertEquals(await formatFrontendV2Source(formatted, "<inline-record>", fix), formatted);
    }
  }
});

Deno.test("repeated inline annotations share one nominal identity", async () => {
  const result = await checkSource(`
    let a = (.{x=1}: Point{x:I32});
    let b = (.{x=2}: Point{x:I32});
    let both = [a, b];
    let use = (a: Point{x:I32}, b: Point{x:I32}) => { [a, b] };
    let local = () => {
      let c: Point{x:I32} = a;
      c
    };
    let c: Point = local();
    let equal = a == b;
  `);
  expectBinding(result.env, "both", { type: "List<Point>", vars: 0 });
  expectBinding(result.env, "c", { type: "Point", vars: 0 });
});

Deno.test("inline references preserve generic parameters without specializing the declaration", async () => {
  const result = await checkSource(`
    let unwrap = (x: Box<t>{value:t}) => { x.value };
    let unwrapAgain = (x: Box<u>{value:u}) => { unwrap(x) };
    let number = unwrapAgain(Box(42));
    let text = unwrapAgain(Box("hello"));
    let callback = (x: Callback<a>{run: a -> a}) => { x };
    let callbackAgain = (x: Callback<b>{run: b -> b}) => { callback(x) };
  `);
  expectBinding(result.env, "number", { type: "Number", vars: 0 });
  expectBinding(result.env, "text", { type: "String", vars: 0 });
  for (
    const source of [
      "record Box<t> = {value:t}; let f=(x:Box<u>{value:I32})=>x;",
      "record Pair<a,b> = {first:a,second:b}; let f=(x:Pair<a,b>{first:b,second:a})=>x;",
      "record Box<t> = {value:t}; let f=(x:Box{value:I32})=>x;",
    ]
  ) await assertRejects(() => checkSource(source), Error, "inline record");
});

Deno.test("inline references reject conflicting names, fields, and nominal field types", async () => {
  for (
    const source of [
      "let a:Point{x:I32}=.{x=1}; let b:Point{x:Bool}=.{x=true};",
      "record Point={x:I32}; let b:Point{x:I32,y:I32}=.{x=1,y=2};",
      "record Point={x:I32,y:I32}; let b:Point{x:I32}=.{x=1};",
      "type Point=I32; let b:Point{x:I32}=.{x=1};",
      "let a:Point{x:I32}=.{x=1}; let b=()=>{let p:Point{x:Bool}=.{x=true};p.x};",
      "record A={x:I32}; record B={x:I32}; record Box={value:A}; let f=(x:Box{value:B})=>x;",
    ]
  ) await assertRejects(() => checkSource(source), Error, "inline record");
});

Deno.test("explicit record redeclarations error in the same scope and allow nested shadowing", async () => {
  for (
    const source of [
      "record Point={x:I32}; record Point={x:I32};",
      "let a:Point{x:I32}=.{x=1}; record Point={x:I32};",
      "let f=()=>{record Point={x:I32}; record Point={x:Bool}; true};",
      "type Point=I32; record Point={x:I32};",
      "record Point={x:I32}; type Point=I32;",
    ]
  ) await assertRejects(() => checkSource(source), Error, "duplicate");
  await checkSource(`
    record Point={x:I32};
    let a=Point(1);
    let f=()=>{record Point={x:Bool}; let p=Point(true); p.x};
    let b:Point=a;
  `);
});

Deno.test("repeated inline shapes reuse constructors and preserve original field order at runtime", async () => {
  const source = `
    record Pair={first:I32,second:String};
    let read=(x:Pair{second:String,first:I32})=>x.second;
    let again=(x:Pair{first:I32,second:String})=>x.first;
    let main=()=>{let p=Pair(7,"hello"); print(read(p)); print(again(p))};
  `;
  const javaScript = await compile(source);
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await importProgram(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["hello", "7"]);
});

Deno.test("inline shapes reuse imported nominal identities without re-exporting their constructors", async () => {
  await checkVirtual(
    "/test/main.wm",
    new Map([
      ["/test/records.wm", "record Point={x:I32}; let value=Point(1);"],
      [
        "/test/helper.wm",
        `
      from "./records.wm" import { Point, value };
      let take=(p:Point{x:I32})=>p.x;
      let local:Point{x:I32}=value;
    `,
      ],
      [
        "/test/main.wm",
        `
      from "./records.wm" import { Point, value };
      from "./helper.wm" import { take, local };
      let points=[value,local,Point(3)];
      let n=take(value);
    `,
      ],
    ]),
  );
});
