import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkVirtual, compileVirtual } from "../src/compiler.ts";

const VEC = `
  record Vec2 = { x: Number, y: Number };

  let succeed = (s: Number) => {
    Vec2(s, s)
  };

  let map = (v: Vec2, f) => {
    Vec2(f(v.x), f(v.y))
  };

  let map2 = (a: Vec2, b: Vec2, f) => {
    Vec2(f(a.x, b.x), f(a.y, b.y))
  };

  let carrier = .{
    succeed = succeed,
    map = map,
    map2 = map2,
  };
`;

const PAIR = `
  record Pair<T> = { left: T, right: T };

  let succeed = (value) => {
    Pair(value, value)
  };

  let map = (p, f) => {
    Pair(f(p.left), f(p.right))
  };

  let map2 = (a, b, f) => {
    Pair(f(a.left, b.left), f(a.right, b.right))
  };

  let carrier = .{ succeed = succeed, map = map, map2 = map2 };
`;

async function runProgram(main: string): Promise<string> {
  const virtualFs = new Map<string, string>([
    ["/test/vec.wm", VEC],
    ["/test/pair.wm", PAIR],
    ["/test/main.wm", main],
  ]);
  const js = await compileVirtual("/test/main.wm", virtualFs);
  const directory = await Deno.makeTempDir();
  try {
    const emitted = `${directory}/main.mjs`;
    await Deno.writeTextFile(emitted, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", emitted],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function checkError(main: string): Promise<string> {
  try {
    await checkVirtual(
      "/test/main.wm",
      new Map<string, string>([
        ["/test/vec.wm", VEC],
        ["/test/pair.wm", PAIR],
        ["/test/main.wm", main],
      ]),
    );
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert(false, "expected a type error");
}

Deno.test("a user carrier lifts primitive operators over its payload", async () => {
  const output = await runProgram(`
    from "./vec.wm" import { Vec2 };

    let main = () => {
      let a = Vec2(1, 2);
      let b = Vec2(3, 4);
      print(a + b);
      print(a - b);
      print(-a)
    };
  `);
  assertEquals(output.split("\n"), [
    "{ x = 4, y = 6 }",
    "{ x = -2, y = -2 }",
    "{ x = -1, y = -2 }",
  ]);
});

Deno.test("a pure operand is injected with the carrier's succeed", async () => {
  // Vec2's `succeed` broadcasts, so scalar operands fall out of the existing
  // pure-operand rule rather than a separate broadcast rule.
  const output = await runProgram(`
    from "./vec.wm" import { Vec2 };

    let main = () => {
      let v = Vec2(1, 2);
      print(v * 3);
      print(2 * v);
      print(Vec2(10, 10) + v * 0.5)
    };
  `);
  assertEquals(output.split("\n"), [
    "{ x = 3, y = 6 }",
    "{ x = 2, y = 4 }",
    "{ x = 10.5, y = 11 }",
  ]);
});

Deno.test("an operator answering outside a monomorphic carrier's payload is rejected", async () => {
  const message = await checkError(`
    from "./vec.wm" import { Vec2 };

    let main = () => {
      print(Vec2(1, 2) < Vec2(3, 4))
    };
  `);
  assertStringIncludes(message, "Bool");
});

Deno.test("operators peel one carrier layer, so mixing carriers is rejected", async () => {
  const message = await checkError(`
    from "./vec.wm" import { Vec2 };

    let main = () => {
      print(Ok(Vec2(1, 2)) + Vec2(3, 4))
    };
  `);
  assertStringIncludes(message, "Vec2");
});

Deno.test("a carrier without andThen still lifts operators", async () => {
  // Vec2 registers succeed/map/map2 and nothing else, so `via` is unavailable
  // while the operators are not.
  const message = await checkError(`
    from "./vec.wm" import { Vec2, carrier };

    let main = () => {
      print(Monad.via carrier ((v) => { v }))
    };
  `);
  assertStringIncludes(message, "fn");
});

Deno.test("Result keeps its own lowering when other carriers are registered", async () => {
  const output = await runProgram(`
    from "./vec.wm" import { Vec2 };

    let main = () => {
      print(Ok(2) + 3);
      print(3 * Ok(4));
      print(-Ok(4))
    };
  `);
  assertEquals(output.split("\n"), ["Ok(5)", "Ok(12)", "Ok(-4)"]);
});

Deno.test("a generic carrier's operators may answer in another payload type", async () => {
  // Pair<T> has a payload argument to replace, so `<` produces Pair<Bool> the
  // way it produces Result<Bool, E> - unlike monomorphic Vec2, which rejects it.
  const output = await runProgram(`
    from "./pair.wm" import { Pair };

    let main = () => {
      let a = Pair(1, 2);
      let b = Pair(10, 20);
      print(a + b);
      print(a * 3);
      print(a < b);
      print(Pair("x", "y") ++ Pair("1", "2"))
    };
  `);
  assertEquals(output.split("\n"), [
    "{ left = 11, right = 22 }",
    "{ left = 3, right = 6 }",
    "{ left = true, right = true }",
    "{ left = x1, right = y2 }",
  ]);
});

Deno.test("Task lifts operators like the other basis carrier", async () => {
  const output = await runProgram(`
    let main = () => {
      (Task.succeed(2) + 3) :> Task.map(print)
    };
  `);
  assertEquals(output, "5");
});

Deno.test("two different carriers cannot meet in one operator", async () => {
  const message = await checkError(`
    let main = () => {
      print(Ok(1) + Task.succeed(2))
    };
  `);
  assertStringIncludes(message, "mixes carriers Result and Task");
});
