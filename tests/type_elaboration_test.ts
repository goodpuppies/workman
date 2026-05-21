import { checkSourceSteps } from "../src/compiler.ts";
import { assertRejects } from "@std/assert";
import { expectStepBinding, expectStepMissing } from "./type_helpers.ts";

Deno.test("Workman elaboration snapshots show declaration-ordered generalized lets", async () => {
  const steps = await checkSourceSteps(`
    let id = (x) => { x };
    let use_number = id(1);
    let use_string = id("s");
  `);

  expectStepBinding(steps, 0, "id", { type: "('a) => 'a", vars: 1 });
  expectStepMissing(steps, 0, "use_number");
  expectStepBinding(steps, 1, "id", { type: "('a) => 'a", vars: 1 });
  expectStepBinding(steps, 1, "use_number", { type: "Number", vars: 0 });
  expectStepBinding(steps, 2, "use_string", { type: "String", vars: 0 });
});

Deno.test("wmsml elaboration snapshots match SML val generalization boundaries", async () => {
  const steps = await checkSourceSteps(
    `
      val id = fn x => x
      val use_number = id 1
      val use_string = id "s"
    `,
    { surface: "wmsml" },
  );

  expectStepBinding(steps, 0, "id", { type: "('a) => 'a", vars: 1 });
  expectStepMissing(steps, 0, "use_number");
  expectStepBinding(steps, 1, "use_number", { type: "Number", vars: 0 });
  expectStepBinding(steps, 2, "use_string", { type: "String", vars: 0 });
});

Deno.test("wmsml datatype elaboration snapshots expose constructors before later vals", async () => {
  const steps = await checkSourceSteps(
    `
      datatype 'a option = NONE | SOME of 'a
      val one = SOME 1
      val get = fn opt =>
        case opt of
          SOME x => x
        | NONE => 0
    `,
    { surface: "wmsml" },
  );

  expectStepBinding(steps, 0, "NONE", { type: "option<a>", vars: 1 });
  expectStepBinding(steps, 0, "SOME", { type: "(a) => option<a>", vars: 1 });
  expectStepMissing(steps, 0, "one");
  expectStepBinding(steps, 1, "one", { type: "option<Number>", vars: 0 });
  expectStepBinding(steps, 2, "get", { type: "(option<Number>) => Number", vars: 0 });
});

Deno.test("Workman simultaneous non-recursive and-group snapshots publish only after group inference", async () => {
  const steps = await checkSourceSteps(`
    let id_a = (x) => { x } and id_b = (y) => { y };
    let use_a = id_a(1);
    let use_b = id_b("s");
  `);

  expectStepBinding(steps, 0, "id_a", { type: "('a) => 'a", vars: 1 });
  expectStepBinding(steps, 0, "id_b", { type: "('a) => 'a", vars: 1 });
  expectStepBinding(steps, 1, "use_a", { type: "Number", vars: 0 });
  expectStepBinding(steps, 2, "use_b", { type: "String", vars: 0 });
});

Deno.test("Workman recursive group snapshots generalize after solving the group", async () => {
  const steps = await checkSourceSteps(`
    let rec id = (x) => { x };
    let use_number = id(1);
    let use_string = id("s");
  `);

  expectStepBinding(steps, 0, "id", { type: "('a) => 'a", vars: 1 });
  expectStepBinding(steps, 1, "use_number", { type: "Number", vars: 0 });
  expectStepBinding(steps, 2, "use_string", { type: "String", vars: 0 });
});

Deno.test("Workman local declaration snapshots do not leak block-local values", async () => {
  const steps = await checkSourceSteps(`
    let outer = () => {
      let local_id = (x) => { x };
      local_id(1)
    };
    let use_outer = outer();
  `);

  expectStepBinding(steps, 0, "outer", { type: "(Void) => Number", vars: 0 });
  expectStepMissing(steps, 0, "local_id");
  expectStepBinding(steps, 1, "use_outer", { type: "Number", vars: 0 });
});

Deno.test("wmsml simultaneous val groups do not expose earlier bindings in the same group", async () => {
  await assertRejects(
    () => checkSourceSteps("val x = 1 and y = x", { surface: "wmsml" }),
    Error,
    "unknown name x",
  );
});

Deno.test("wmsml val rec rejects unguarded recursive values", async () => {
  await assertRejects(
    () => checkSourceSteps("val rec x = x", { surface: "wmsml" }),
    Error,
    "recursive references must be guarded by a function",
  );
});

Deno.test("wmsml arrow type annotations are right associative", async () => {
  const steps = await checkSourceSteps(
    `
      val keep: int -> int -> int = fn x => fn y => x
      val result = keep 1 2
    `,
    { surface: "wmsml" },
  );

  expectStepBinding(steps, 0, "keep", { type: "(Number) => (Number) => Number", vars: 0 });
  expectStepBinding(steps, 1, "result", { type: "Number", vars: 0 });
});

Deno.test("Workman annotation type variables are scoped across one let-and group", async () => {
  await assertRejects(
    () => checkSourceSteps('let x: t = 1 and y: t = "s";'),
    Error,
    "type mismatch",
  );

  const steps = await checkSourceSteps("let x: t = 1 and y: t = 2;");
  expectStepBinding(steps, 0, "x", { type: "Number", vars: 0 });
  expectStepBinding(steps, 0, "y", { type: "Number", vars: 0 });
});

Deno.test("wmsml annotation type variables are scoped across one val-and group", async () => {
  await assertRejects(
    () => checkSourceSteps(`val x: 'a = 1 and y: 'a = "s"`, { surface: "wmsml" }),
    Error,
    "type mismatch",
  );

  const steps = await checkSourceSteps("val x: 'a = 1 and y: 'a = 2", { surface: "wmsml" });
  expectStepBinding(steps, 0, "x", { type: "Number", vars: 0 });
  expectStepBinding(steps, 0, "y", { type: "Number", vars: 0 });
});
