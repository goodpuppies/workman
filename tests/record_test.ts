import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  checkFile,
  checkSource,
  checkSourceSteps,
  checkVirtual,
  compile,
  compileVirtual,
} from "../src/compiler.ts";
import { show } from "../src/types.ts";
import { expectBinding, expectStepBinding, expectStepMissing } from "./type_helpers.ts";

Deno.test("record remains usable as a field, variable and parameter name", async () => {
  const result = await checkSource(`
    record PostViewWire = { record: Js.Value, count: Number, active: Bool };
    let post = PostViewWire{ record = JSON{ record: "text" }, count = 42, active = true };
    let copy: PostViewWire = .{ ..post, record = JSON{ record: "copy" } };
    let object = copy.record;
    let .{ record = bound, count = number } = post;
    let read = (.{ record = value }: PostViewWire) => { value };
    let matched = match(post) { .{ record = Var(value) } => { value } };
    let selected = read(post);
    let record = post.record;
    let identity = (record) => { record };
    let retained = identity(record);
    let flag = post.active;
  `);

  for (const name of ["object", "bound", "matched", "selected", "retained"]) {
    expectBinding(result.env, name, { type: "Js.Value", vars: 0 });
  }
  expectBinding(result.env, "number", { type: "Number", vars: 0 });
  expectBinding(result.env, "flag", { type: "Bool", vars: 0 });
});

Deno.test("nominal records infer construction and field access", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
    let xVal = p.x;
  `);

  expectBinding(result.env, "p", { type: "Point", vars: 0 });
  expectBinding(result.env, "xVal", { type: "Number", vars: 0 });
});

Deno.test("explicit nominal record expressions select their record and infer type arguments", async () => {
  const result = await checkSource(`
    record User = { name: String };
    record Box<T> = { value: T };
    record Empty = {};
    let user = User{ name = "Ada" };
    let box = Box{ value = 42 };
    let empty = Empty{};
  `);

  expectBinding(result.env, "user", { type: "User", vars: 0 });
  expectBinding(result.env, "box", { type: "Box<Number>", vars: 0 });
  expectBinding(result.env, "empty", { type: "Empty", vars: 0 });
});

Deno.test("explicit nominal record expressions support punning and spread", async () => {
  const result = await checkSource(`
    record User = { name: String, active: Bool };
    let name = "Ada";
    let first = User{ name, active = true };
    let second = User{ ..first, active = false };
  `);

  expectBinding(result.env, "first", { type: "User", vars: 0 });
  expectBinding(result.env, "second", { type: "User", vars: 0 });
});

Deno.test("qualified explicit nominal record expressions resolve imported record types", async () => {
  await checkVirtual(
    "/test/main.wm",
    new Map([
      ["/test/records.wm", "record Point = { x: Number, y: Number };"],
      [
        "/test/main.wm",
        'from "./records.wm" import * as Geometry; let point = Geometry.Point{ x = 1, y = 2 };',
      ],
    ]),
  );
});

Deno.test("explicit nominal record expressions reject non-record targets", async () => {
  await assertRejects(
    () => checkSource("type Option<T> = None | Some<T>; let bad = Option{};"),
    Error,
    "Option is not a record type",
  );
});

Deno.test("polymorphic record fields preserve type parameters", async () => {
  const result = await checkSource(`
    record Pair<A, B> = { first: A, second: B };
    let pair = .{ first = 1, second = true };
    let first = pair.first;
    let second = pair.second;
  `);

  expectBinding(result.env, "pair", { type: "Pair<Number, Bool>", vars: 0 });
  expectBinding(result.env, "first", { type: "Number", vars: 0 });
  expectBinding(result.env, "second", { type: "Bool", vars: 0 });
});

Deno.test("record declarations expose ordered polymorphic constructors", async () => {
  const result = await checkSource(`
    record Pair<A, B> = { first: A, second: B };
    let numberText = Pair(1, "one");
    let boolNumber = Pair(true, 2);
  `);

  expectBinding(result.env, "Pair", {
    type: "(A, B) -> Pair<A, B>",
    vars: 2,
  });
  expectBinding(result.env, "numberText", {
    type: "Pair<Number, String>",
    vars: 0,
  });
  expectBinding(result.env, "boolNumber", {
    type: "Pair<Bool, Number>",
    vars: 0,
  });
});

Deno.test("record constructor applications retain non-expansive generalization", async () => {
  const result = await checkSource(`
    record Identity<A> = { run: A -> A };
    let identity = Identity((value) => { value });
    let number = identity.run(1);
    let text = identity.run("text");
  `);

  expectBinding(result.env, "identity", {
    type: "Identity<'a>",
    vars: 1,
  });
  expectBinding(result.env, "number", { type: "Number", vars: 0 });
  expectBinding(result.env, "text", { type: "String", vars: 0 });
});

Deno.test("record constructors compose as ordinary Result.map functions", async () => {
  const result = await checkSource(`
    record IndexArguments = {
      source: String,
      output: String,
      unknownOutput: String,
    };
    let arguments = Result|Ok("source"), Ok("output"), Ok("unknown")|
      :> Result.map(IndexArguments);
  `);

  expectBinding(result.env, "arguments", {
    type: "Result<IndexArguments, 'a>",
    vars: 0,
  });
});

Deno.test("record constructors preserve declaration order at runtime and across imports", async () => {
  const javaScript = await compileVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/records.wm",
        `record Pair<A, B> = { first: A, second: B };
         record Empty = {};
         record Box<A> = { value: A };`,
      ],
      [
        "/test/main.wm",
        `from "./records.wm" import { Pair, Empty, Box };
         let main = () => {
           let pair = Result|Ok("left"), Ok("right")| :> Result.map(Pair);
           let empty = Empty();
           let box = Box(3);
           match(pair) {
             Ok(value) => {
               print(value.first ++ "/" ++ value.second);
               print(box.value);
               print(empty)
             },
             Err(_) => { Panic("unexpected") }
           }
         };`,
      ],
    ]),
  );

  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }

  assertEquals(output, ["left/right", "3", "{  }"]);
});

Deno.test("record patterns bind fields through nominal record types", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
    let .{ x, y } = p;
    let sum = x + y;
  `);

  expectBinding(result.env, "x", { type: "Number", vars: 0 });
  expectBinding(result.env, "y", { type: "Number", vars: 0 });
  expectBinding(result.env, "sum", { type: "Number", vars: 0 });
});

Deno.test("records support JavaScript-style mixed-case field names", async () => {
  const result = await checkSource(`
    record Current = { FeelsLikeC: String, windspeedKmph: String };
    let current: Current = .{ FeelsLikeC = "4", windspeedKmph = "12" };
    let feels = current.FeelsLikeC;
    let .{ windspeedKmph = wind } = current;
    let payload = JSON{ FeelsLikeC: feels };
  `);

  expectBinding(result.env, "current", { type: "Current", vars: 0 });
  expectBinding(result.env, "feels", { type: "String", vars: 0 });
  expectBinding(result.env, "wind", { type: "String", vars: 0 });
  expectBinding(result.env, "payload", { type: "Js.Value", vars: 0 });
});

Deno.test("record elaboration snapshots expose record values after declaration order", async () => {
  const steps = await checkSourceSteps(`
    record Point = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
    let getX = (point: Point) => { point.x };
  `);

  expectStepBinding(steps, 0, "Point", {
    type: "(Number, Number) -> Point",
    vars: 0,
  });
  expectStepMissing(steps, 0, "p");
  expectStepBinding(steps, 1, "p", { type: "Point", vars: 0 });
  expectStepBinding(steps, 2, "getX", { type: "Point -> Number", vars: 0 });
});

Deno.test("records warn and choose first nominal type on shape-only ambiguity", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    record Vector = { x: Number, y: Number };
    let p = .{ x = 10, y = 20 };
  `);

  expectBinding(result.env, "p", { type: "Point", vars: 0 });
  assertEquals(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "record.ambiguous-literal",
  ]);
  assertStringIncludes(result.warnings[0], "using first matching record type called Point");
  assertStringIncludes(result.warnings[0], "Candidates: Point, Vector");
  assertStringIncludes(result.warnings[0], "Hint: use an annotation like `x: Point = .{ ... }`");
  assertStringIncludes(result.warnings[0], "or its ordered constructor like `x = Point(...)`");
});

Deno.test("record annotations disambiguate same-shaped nominal records", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    record Vector = { x: Number, y: Number };
    let p: Point = .{ x = 10, y = 20 };
    let v: Vector = .{ x = 1, y = 2 };
  `);

  expectBinding(result.env, "p", { type: "Point", vars: 0 });
  expectBinding(result.env, "v", { type: "Vector", vars: 0 });
});

Deno.test("record literals support spread update and field punning", async () => {
  const source = `
    record Point = { x: Number, y: Number };
    let p1: Point = .{ x = 10, y = 20 };
    let x = 100;
    let p2 = .{ ..p1, x };
    let p3: Point = .{ ..p2, y = 30 };
  `;
  const result = await checkSource(source);
  const js = await compile(source);

  expectBinding(result.env, "p2", { type: "Point", vars: 0 });
  expectBinding(result.env, "p3", { type: "Point", vars: 0 });
  assertStringIncludes(js, "...");
});

Deno.test("record spread uses annotated nominal target for nested literals", async () => {
  const result = await checkSource(`
    record Point = { x: Number, y: Number };
    record Vector = { x: Number, y: Number };
    let v: Vector = .{ .. .{ x = 1, y = 2 }, x = 3 };
  `);

  expectBinding(result.env, "v", { type: "Vector", vars: 0 });
});

Deno.test("record updates infer an unannotated spread parameter from overridden fields", async () => {
  const result = await checkSource(`
    record PetState = {
      name: String,
      hunger: Number,
      happiness: Number,
      energy: Number,
      age: Number
    };
    let feed = (state) => {
      .{
        ..state,
        hunger = state.hunger - 30,
        energy = state.energy + 5,
      }
    };
  `);

  expectBinding(result.env, "feed", { type: "PetState -> PetState", vars: 0 });
});

Deno.test("imported records remain nominal across file boundaries", async () => {
  const virtualFs = new Map<string, string>([
    [
      "/test/a.wm",
      "record Point = { x: Number, y: Number }; let make = () => { .{ x = 1, y = 2 } };",
    ],
    [
      "/test/b.wm",
      "record Point = { x: Number, y: Number }; let make = () => { .{ x = 1, y = 2 } };",
    ],
    [
      "/test/main.wm",
      'from "./a.wm" import * as A; from "./b.wm" import * as B; let good: A.Point = A.make(); let bad: A.Point = B.make();',
    ],
  ]);

  await assertRejects(() => checkVirtual("/test/main.wm", virtualFs), Error, "type mismatch");
});

Deno.test("imported record annotations guide record literals", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/point.wm", "record Point = { x: Number, y: Number };"],
    [
      "/test/main.wm",
      'from "./point.wm" import * as Geometry; let p: Geometry.Point = .{ x = 1, y = 2 }; let x = p.x;',
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("named imports expose exported record types", async () => {
  const virtualFs = new Map<string, string>([
    ["/test/point.wm", "record Point = { x: Number, y: Number };"],
    [
      "/test/main.wm",
      'from "./point.wm" import { Point }; let p: Point = .{ x = 1, y = 2 }; let x = p.x;',
    ],
  ]);

  await checkVirtual("/test/main.wm", virtualFs);
});

Deno.test("block-local record names do not escape", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let p = {
          record Point = { x: Number, y: Number };
          .{ x = 1, y = 2 }
        };
      `),
    Error,
    "local type escapes scope",
  );
});

Deno.test("record declarations reject duplicate fields", async () => {
  await assertRejects(
    () => checkSource("record Bad = { x: Number, x: Bool };"),
    Error,
    "duplicate record field x",
  );
});

Deno.test("record patterns reject duplicate fields", async () => {
  await assertRejects(
    () =>
      checkSource(`
        record Point = { x: Number };
        let p = .{ x = 1 };
        let .{ x = a, x = b } = p;
      `),
    Error,
    "duplicate record field x",
  );
});

Deno.test("record literals reject missing and extra fields against the nominal target", async () => {
  await assertRejects(
    () =>
      checkSource(`
        record Point = { x: Number, y: Number };
        let missing: Point = .{ x = 1 };
      `),
    Error,
    "record literal for Point has missing fields: y",
  );
  await assertRejects(
    () =>
      checkSource(`
        record Point = { x: Number };
        let extra: Point = .{ x = 1, y = 2 };
      `),
    Error,
    "record literal for Point has unknown fields: y",
  );
});

Deno.test("field requirements specialize independently for different nominal records", async () => {
  const result = await checkSource(`
    record Point = { x: Number };
    record Offset = { x: String };
    let getX = (value) => { value.x };
    let px = getX(Point(1));
    let ox = getX(Offset("text"));
  `);
  expectBinding(result.env, "getX", { type: "'a -> 'b where 'a.x: 'b", vars: 2 });
  expectBinding(result.env, "px", { type: "Number", vars: 0 });
  expectBinding(result.env, "ox", { type: "String", vars: 0 });
  assertEquals(result.diagnostics, []);
});

Deno.test("multiple field requirements retain the same receiver", async () => {
  const result = await checkSource(`
    record Point = { x: Number };
    record Offset = { x: Number, y: Number };
    let getOffsetX = (value) => {
      let y = value.y;
      value.x
    };
  `);

  expectBinding(result.env, "getOffsetX", {
    type: "'a -> 'b where 'a.y: 'c, 'a.x: 'b",
    vars: 3,
  });
  assertEquals(result.diagnostics, []);
  assertEquals(result.facts.recordProjectionRequirements.size, 2);
  assertEquals(result.facts.recordProjections.size, 0);
});

Deno.test("call parameter types discard incompatible nominal projection owners", async () => {
  const result = await checkSource(`
    record Trivia = { kind: String };
    record Token = { kind: Number };
    let acceptKind = (kind: Number) => { kind };
    let readKind = (token) => { acceptKind(token.kind) };
  `);

  expectBinding(result.env, "readKind", { type: "'a -> Number where 'a.kind: Number", vars: 1 });
  assertEquals(result.diagnostics, []);
  assertEquals(result.facts.recordProjectionRequirements.size, 1);
});

Deno.test("call parameter types constrain fields without choosing a nominal owner", async () => {
  const result = await checkSource(`
    record Point = { x: Number };
    record Offset = { x: Number };
    let acceptX = (x: Number) => { x };
    let readX = (value) => { acceptX(value.x) };
  `);

  expectBinding(result.env, "readX", { type: "'a -> Number where 'a.x: Number", vars: 1 });
  assertEquals(result.diagnostics, []);
});

Deno.test("nominal record parameter annotations resolve shared field identities", async () => {
  const result = await checkSource(`
    record Point = { x: Number };
    record Offset = { x: Number };
    let getPointX = (value: Point) => { value.x };
    let getOffsetX = (value: Offset) => { value.x };
  `);

  expectBinding(result.env, "getPointX", { type: "Point -> Number", vars: 0 });
  expectBinding(result.env, "getOffsetX", { type: "Offset -> Number", vars: 0 });
  assertEquals(result.diagnostics, []);
  assertEquals(result.facts.recordProjections.size, 2);
  assertEquals(
    [...result.facts.recordProjections.values()].flat().map(({ record }) => record.name),
    ["Point", "Offset"],
  );
});

Deno.test("repeated projections retain their receiver and result relationships", async () => {
  const result = await checkSource(`
    record PairOps<A, B> = {
      first: A -> B,
      second: B -> A,
    };
    let useBoth = (ops, value) => {
      ops.second(ops.first(value))
    };
  `);

  expectBinding(result.env, "useBoth", {
    type: "('a, 'b) -> 'c where 'a.second: 'd -> 'c, 'a.first: 'b -> 'd",
    vars: 4,
  });
});

Deno.test("record function fields compose with whitespace curried calls", async () => {
  const result = await checkSource(`
    record Task = { fn: (Void -> Number) -> Number };
    let via = (x) => {
      (f) => {
        x.fn(f)
      }
    };
    let task: Task = .{ fn = (f) => { f() } };
    let value = via task () => { 42 };
  `);

  expectBinding(result.env, "value", { type: "Number", vars: 0 });
});

Deno.test("function field requirements specialize at the call", async () => {
  const result = await checkSource(`
    record TaskLike = { fn: (Void -> Number) -> Number };
    let via = (x) => {
      (f) => {
        x.fn(f)
      }
    };
    let task: TaskLike = .{ fn = (f) => { f() } };
    let value = via task () => { 42 };
  `);

  expectBinding(result.env, "via", {
    type: "'a -> 'b -> 'c where 'a.fn: 'b -> 'c",
    vars: 3,
  });
  expectBinding(result.env, "value", { type: "Number", vars: 0 });
  assertEquals(result.diagnostics, []);
});

Deno.test("nominal projection results cannot acquire fields from another record", async () => {
  await assertRejects(
    () =>
      checkSource(`
        record HasX = { x: Void -> Number };
        record HasY = { y: Void -> String };
        let passX = (value) => {
          let xf = value.x;
          value
        };
        let onlyX: HasX = .{ x = () => { 1 } };
        let claimed = passX(onlyX);
        let result: String = claimed.y();
      `),
    Error,
    "HasX has no field y",
  );
});

Deno.test("unknown dotted fields cannot escape as structural nominal casts", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let retainMystery = (value) => {
          let _ = value.mystery;
          value
        };
        record A = { mystery: Number, onlyA: String };
        record B = { mystery: Number, onlyB: Void -> Number };
        let a: A = .{ mystery = 1, onlyA = "a" };
        let forged: B = retainMystery(a);
        let boom = forged.onlyB(void);
      `),
    Error,
    "unknown record field mystery",
  );
});

Deno.test("ordinary branch constraints resolve nominal projections with annotations erased", async () => {
  for (const annotation of ["", ": Option<LockEntry>"]) {
    const result = await checkSource(`
record Candidate = { version: String, published: String };
record LockEntry = { name: String, version: String };
let keep = (locked${annotation}, version) => {
  match(locked) {
    Some(entry) => {
      if (entry.version == version) { Task.succeed(entry) }
      else { Task.fail("different") :> Task.map((_) => { LockEntry("n", version) }) }
    },
    None => { Task.succeed(LockEntry("n", version)) },
  }
};`);
    assertEquals(result.diagnostics, []);
    assertEquals(result.warnings.some((message) => message.includes("ambiguous record")), false);
    assertStringIncludes(show(result.env.get("keep")!.type), "Option<LockEntry>");
  }
});

Deno.test("generalized field requirements keep generic record arguments connected", async () => {
  const result = await checkSource(`
record First<T> = { value: T };
record Second<T> = { value: T };
let get = (item) => { item.value };
let n: Number = get(First(1));
let s: String = get(First("hi"));
let use = (items) => {
  let read = (item) => { item.value };
  let values = List.map(items, read);
  (values, Second("evidence"))
};`);
  assertEquals(result.env.get("get")!.vars.length, 2);
});

Deno.test("ambiguous receivers satisfy every projected field regardless of projection or declaration order", async () => {
  const records = [
    "record Wrong = { cursor: Option<String>, posts: List<Bool> };",
    "record Right = { cursor: Option<String>, posts: List<Number> };",
  ];
  for (const declarations of [records, [...records].reverse()]) {
    for (
      const statements of [
        "let cursor = feed.cursor; let posts = feed.posts;",
        "let posts = feed.posts; let cursor = feed.cursor;",
      ]
    ) {
      const result = await checkSource(`
        ${declarations.join("\n")}
        let render = (feed) => {
          ${statements}
          (cursor, List.map(posts, (post) => { post + 1 }))
        };
        let result = render(Right(None, [1]));
      `);
      expectBinding(result.env, "result", { type: "(Option<String>, List<Number>)", vars: 0 });
      assertEquals(result.warnings, []);
    }
  }
});

Deno.test("projection groups merge when independent receivers become aliases", async () => {
  const result = await checkSource(`
    record Wrong = { cursor: Option<String>, posts: List<Bool> };
    record Right = { cursor: Option<String>, posts: List<Number> };
    let render = (first, second) => {
      let cursor = first.cursor;
      let posts = List.map(second.posts, (post) => { post + 1 });
      let keep = if (true) { first } else { second };
      (keep, cursor, posts)
    };
  `);
  expectBinding(result.env, "render", {
    type: "('a, 'a) -> ('a, 'b, List<Number>) where 'a.posts: List<Number>, 'a.cursor: 'b",
    vars: 2,
  });
  assertEquals(result.warnings, []);
});

Deno.test("candidate checks share generic parameters across projected fields", async () => {
  const result = await checkSource(`
    record Same<T> = { first: T, second: T };
    record Different<A, B> = { first: A, second: B };
    let read = (pair) => {
      let first = pair.first;
      let second = pair.second;
      (first + 1, second ++ "!")
    };
    let value = read(Different(2, "text"));
  `);
  expectBinding(result.env, "read", {
    type: "'a -> (Number, String) where 'a.first: Number, 'a.second: String",
    vars: 1,
  });
  expectBinding(result.env, "value", { type: "(Number, String)", vars: 0 });
  assertEquals(result.warnings, []);
});

Deno.test("nested projection requirements eliminate incompatible outer record candidates", async () => {
  const result = await checkSource(`
    record WrongInner = { value: Bool };
    record RightInner = { value: Number };
    record WrongOuter = { cursor: Option<String>, item: WrongInner };
    record RightOuter = { cursor: Option<String>, item: RightInner };
    let read = (outer) => {
      let cursor = outer.cursor;
      let number = outer.item.value + 1;
      (cursor, number)
    };
  `);
  expectBinding(result.env, "read", {
    type: "'a -> ('b, Number) where 'a.cursor: 'b, 'a.item: 'c, 'c.value: Number",
    vars: 3,
  });
  assertEquals(result.warnings, []);
});

Deno.test("candidate checks retain equality requirements on projected results", async () => {
  const result = await checkSource(`
    record FunctionValue = { value: Number -> Number };
    record NumberValue = { value: Number };
    let equal = (record) => { record.value == record.value };
  `);
  expectBinding(result.env, "equal", { type: "'a -> Bool where 'a.value: 'b", vars: 2 });
  assertEquals(result.warnings, []);
});

Deno.test("joint projection resolution survives imports and emits the selected nominal record", async () => {
  const sources = new Map([
    [
      "/test/records.wm",
      `
      record Wrong = { cursor: Option<String>, posts: List<Bool> };
      record Right = { cursor: Option<String>, posts: List<Number> };
    `,
    ],
    [
      "/test/main.wm",
      `
      from "./records.wm" import * as Records;
      let render = (feed) => {
        let cursor = feed.cursor;
        let posts = List.map(feed.posts, (post) => { post + 1 });
        List.length(posts)
      };
      let main = () => { print(render(Records.Right(None, [1, 2]))) };
    `,
    ],
  ]);
  const javaScript = await compileVirtual("/test/main.wm", sources);
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["2"]);
});

Deno.test("candidate checks retain JS representation requirements on projected results", async () => {
  const result = await checkSource(`
    from js.global("console") import unsafe { log: Js.Value -> Void };
    record ListValue = { value: List<Number> };
    record TextValue = { value: String };
    let emit = (record) => { log(record.value) };
    let used = emit(TextValue("text"));
  `);
  expectBinding(result.env, "emit", { type: "TextValue -> Void", vars: 0 });
  assertEquals(result.warnings, []);
});

Deno.test("exported field requirements accept caller-owned nominal types and preserve identity", async () => {
  const sources = new Map([
    [
      "/test/access.wm",
      `
      record KnownToken = { accessJwt: String };
      let token = (record) => { record.accessJwt };
      let retain = (record) => { let _ = record.accessJwt; record };
      let mapToken = (record, f) => { f(record.accessJwt) };
      let same = (record) => { let _ = record.accessJwt; record == record };
    `,
    ],
    [
      "/test/main.wm",
      `
      from "./access.wm" import * as Access;
      record Session = { accessJwt: String, did: String };
      record AppFeeds = { accessJwt: Number, posts: List<Number> };
      let session = Session("jwt", "did:example");
      let feeds = AppFeeds(42, [1]);
      let sessionToken = Access.token(session);
      let feedsToken = Access.token(feeds);
      let keptSession = Access.retain(session);
      let keptFeeds = Access.retain(feeds);
      let result = Access.mapToken(session, (token) => { token ++ "!" });
      let main = () => {
        print(sessionToken ++ "/" ++ keptSession.did);
        print(feedsToken + List.length(keptFeeds.posts));
        print(result);
        print(Access.same(session))
      };
    `,
    ],
  ]);
  const javaScript = await compileVirtual("/test/main.wm", sources);
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["jwt/did:example", "43", "jwt!", "true"]);
});

Deno.test("a generalized receiver cannot be cast to a different nominal identity", async () => {
  await assertRejects(
    () =>
      checkSource(`
      record Session = { token: String, did: String };
      record AppFeeds = { token: String, posts: List<Number> };
      let retain = (record) => { let _ = record.token; record };
      let session = Session("jwt", "did:example");
      let forged: AppFeeds = retain(session);
    `),
    Error,
    "type mismatch",
  );
});

Deno.test("field obligations retain shared generic parameters at each call", async () => {
  const source = `
    record Same<T> = { first: T, second: T };
    record Different<A, B> = { first: A, second: B };
    let read = (record) => { (record.first + 1, record.second ++ "!") };
  `;
  const good = await checkSource(source + 'let pair = read(Different(1, "text"));');
  expectBinding(good.env, "pair", { type: "(Number, String)", vars: 0 });
  await assertRejects(() => checkSource(source + "let bad = read(Same(1, 2));"), Error);
});

Deno.test("field equality requirements survive independent polymorphic uses", async () => {
  const source = `
    record TextValue = { value: String };
    record NumberValue = { value: Number };
    record FunctionValue = { value: Number -> Number };
    let same = (record) => { record.value == record.value };
  `;
  const good = await checkSource(
    source + `
    let text = same(TextValue("x"));
    let number = same(NumberValue(1));
  `,
  );
  expectBinding(good.env, "text", { type: "Bool", vars: 0 });
  expectBinding(good.env, "number", { type: "Bool", vars: 0 });
  await assertRejects(
    () => checkSource(source + "let bad = same(FunctionValue((x) => { x }));"),
    Error,
    "does not admit equality",
  );
});

Deno.test("imported nested field requirements support caller-owned recursive records", async () => {
  const javaScript = await compileVirtual(
    "/test/main.wm",
    new Map([
      [
        "/test/access.wm",
        `
      record KnownNode = { value: String, next: Option<KnownNode> };
      let nextValue = (node) => {
        match(node.next) {
          None => { node.value },
          Some(other) => { other.value },
        }
      };
    `,
      ],
      [
        "/test/main.wm",
        `
      from "./access.wm" import * as Access;
      record Node = { next: Option<Node>, value: String };
      let main = () => {
        print(Access.nextValue(Node(Some(Node(None, "inner")), "outer")))
      };
    `,
      ],
    ]),
  );
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await import(`data:text/javascript;base64,${btoa(javaScript)}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["inner"]);
});

Deno.test("field requirements cannot hide a local nominal type in an escaping function", async () => {
  await assertRejects(
    () =>
      checkSource(`
      let make = () => {
        record Hidden = { value: Number };
        record Wrapper = { hidden: Hidden };
        let requireHidden = (value: Hidden) => { void };
        let retain = (record) => { requireHidden(record.hidden); record };
        retain
      };
    `),
    Error,
    "local type escapes scope",
  );
});

Deno.test("local projection helpers retain captured receiver and result relationships", async () => {
  const result = await checkSource(`
    record NumberValue = { value: Number };
    record StringValue = { value: String };
    let make = (record) => {
      let read = () => { record.value };
      read
    };
    let number = make(NumberValue(1))();
    let text = make(StringValue("text"))();
  `);
  expectBinding(result.env, "number", { type: "Number", vars: 0 });
  expectBinding(result.env, "text", { type: "String", vars: 0 });
});

Deno.test("merging receiver aliases checks equal-label field requirements immediately", async () => {
  await assertRejects(
    () =>
      checkSource(`
      record NumberValue = { value: Number };
      record StringValue = { value: String };
      let incompatible = (left, right) => {
        let number = left.value + 1;
        let text = right.value ++ "!";
        if (true) { left } else { right }
      };
    `),
    Error,
    "record field value",
  );
});

Deno.test("recursive field relationships merge without unfolding or losing receiver identity", async () => {
  const result = await checkSource(`
    record Loop = { next: Loop };
    let merge = (first, second) => {
      let _ = if (true) { first } else { first.next };
      let _ = if (true) { second } else { second.next };
      if (true) { first } else { second }
    };
  `);
  expectBinding(result.env, "merge", {
    type: "('a, 'a) -> 'a where 'a.next: 'a",
    vars: 1,
  });
});
