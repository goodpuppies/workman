import { assertEquals, assertThrows } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { inferModule } from "../src/infer.ts";
import { parse } from "../src/parser.ts";
import { expectBinding } from "./type_helpers.ts";

const cli = new URL("../src/main.ts", import.meta.url).pathname;

Deno.test("Result and Option combinators infer generically", async () => {
  const result = await checkSource(`
    let parseAge = (n) => {
      if (n < 0) { Err("negative") } else { Ok(n) }
    };
    let doubled = parseAge(21) :> Result.map((n) => { n * 2 });
    let chained = parseAge(21) :> Result.andThen((n) => { parseAge(n - 50) })
      :> Result.mapErr((e) => { "bad: " ++ e });
    let fallback = parseAge(0 - 1) :> Result.withDefault(0);
    let opt = Some(3) :> Option.map((n) => { n + 1 }) :> Option.andThen((n) => {
      if (n > 3) { Some(n) } else { None }
    });
    let plain = opt :> Option.withDefault(0);
    let listMapped = [1, 2, 3] :> List.map((n) => { n + 1 });
    let traversed = [1, 2, 3] :> Result.traverse((n) => {
      if (n > 0) { Ok(n * 2) } else { Err(Panic("bad")) }
    });
    let collectedResults = [Ok(1), Ok(2), Ok(3)] :> Result.collectList;
    let collectedOptions = [Some(1), Some(2), Some(3)] :> Option.collectList;
    let traversedArray = JSON[1, 2, 3] :> Json.assert :> Result.andThen((items) => {
      items :> Js.Array.toList :> Result.traverse((n) => {
        if (n > 0) { Ok(n * 2) } else { Err(Panic("bad")) }
      }) :> Result.map(Js.Array.fromList)
    });
    let task = Err("bad") :> Task.fromResult :> Task.recover((_) => { 2 })
      :> Task.andThen((n) => { Task.succeed(n + 1) });
    let pairedTask = Task.map2(Task.succeed(1), Task.succeed(2), (a, b) => { a + b });
    let collectedTasks = [Task.succeed(1), Task.succeed(2), Task.succeed(3)] :> Task.collectList;
    let taskItems = [1, 2]
      :> Task.traverse((n) => {
        Task.succeed(n * 2)
      });
    let taskArrayItems = JSON[1, 2] :> Json.assert :> Result.mapErr((_) => { "json" })
      :> Task.fromResult
      :> Task.andThen((items) => {
        items :> Js.Array.toList :> Task.traverse((n) => { Task.succeed(n * 2) })
          :> Task.map(Js.Array.fromList)
      });
    let allResults = Js.Array.fromList([Ok(1), Ok(2)]) :> Result.all;
  `);
  expectBinding(result.env, "doubled", { type: "Result<Number, String>", vars: 0 });
  expectBinding(result.env, "chained", { type: "Result<Number, String>", vars: 0 });
  expectBinding(result.env, "fallback", { type: "Number", vars: 0 });
  expectBinding(result.env, "opt", { type: "Option<Number>", vars: 0 });
  expectBinding(result.env, "plain", { type: "Number", vars: 0 });
  expectBinding(result.env, "listMapped", { type: "List<Number>", vars: 0 });
  expectBinding(result.env, "traversed", { type: "Result<List<Number>, 'a>", vars: 0 });
  expectBinding(result.env, "collectedResults", { type: "Result<List<Number>, 'a>", vars: 0 });
  expectBinding(result.env, "collectedOptions", { type: "Option<List<Number>>", vars: 0 });
  expectBinding(result.env, "traversedArray", {
    type: "Result<Js.Array<Number>, Js.Error>",
    vars: 0,
  });
  expectBinding(result.env, "task", { type: "Task<Number, String>", vars: 0 });
  expectBinding(result.env, "pairedTask", { type: "Task<Number, 'a>", vars: 0 });
  expectBinding(result.env, "collectedTasks", { type: "Task<List<Number>, 'a>", vars: 0 });
  expectBinding(result.env, "taskItems", {
    type: "Task<List<Number>, 'a>",
    vars: 0,
  });
  expectBinding(result.env, "taskArrayItems", {
    type: "Task<Js.Array<Number>, String>",
    vars: 0,
  });
  expectBinding(result.env, "allResults", {
    type: "Result<Js.Array<Number>, 'a>",
    vars: 0,
  });
  assertEquals(result.env.get("Option.map")?.imported, true);
  assertEquals(result.env.get("Option.map")?.basis ?? false, false);
  assertEquals(result.env.get("List.map")?.imported, true);
  assertEquals(result.env.get("List.map")?.basis ?? false, false);
  assertEquals(result.env.get("Result.map")?.imported, true);
  assertEquals(result.env.get("Result.map")?.basis ?? false, false);
  assertEquals(result.env.get("Result.all")?.imported, true);
  assertEquals(result.env.get("Result.all")?.basis ?? false, false);
});

Deno.test("Monad.lift works over structural fn records", async () => {
  const result = await checkSource(`
    record TaskLike = { fn: (() => Number) => Number };
    let task: TaskLike = .{ fn = (f) => { f() } };
    let value = Monad.lift task () => { 42 };
  `);

  expectBinding(result.env, "value", { type: "Number", vars: 0 });
  assertEquals(result.env.get("Monad.lift")?.imported, true);
});

Deno.test("Monad.lift composes over Task.fn", async () => {
  const result = await checkSource(`
    record User = { login: String, name: String };
    let fetchUser = Monad.lift Task (login) => {
      .{ login = login, name = login ++ " Lovelace" } :> Task.succeed
    };
    let getDisplayName = Monad.lift Task (user) => {
      user.name :> Task.succeed
    };
    let greeting = "Ada" :> Task.succeed :> fetchUser :> getDisplayName;
  `);

  expectBinding(result.env, "fetchUser", {
    type: "(Task<String, 'a>) => Task<User, 'a>",
    vars: 0,
  });
  expectBinding(result.env, "getDisplayName", {
    type: "(Task<User, 'a>) => Task<String, 'a>",
    vars: 0,
  });
  expectBinding(result.env, "greeting", { type: "Task<String, 'a>", vars: 0 });
});

Deno.test("Monad.lift composes over Result.fn", async () => {
  const result = await checkSource(`
    let liftR = Monad.lift Result;
    let keepNumber = liftR (n) => {
      Ok(n)
    };
    let value = Ok(1) :> keepNumber;
  `);

  expectBinding(result.env, "keepNumber", {
    type: "(Result<Number, 'a>) => Result<Number, 'a>",
    vars: 0,
  });
  expectBinding(result.env, "value", { type: "Result<Number, 'a>", vars: 0 });
});

Deno.test("Result carrier coercion infers over primitive operators", async () => {
  const result = await checkSource(`
    let liftR = Monad.lift Result;
    let keepNumber = liftR (n) => {
      Ok(n)
    };
    let sum = Ok(2) + 3;
    let product = 3 * Ok(4);
    let quotient = Ok(8) / Ok(2);
    let negated = -Ok(4);
    let inverted = !Ok(false);
    let liftedCall = keepNumber((Ok(9) - 1) / 2);
  `);

  expectBinding(result.env, "sum", { type: "Result<Number, 'a>", vars: 0 });
  expectBinding(result.env, "product", { type: "Result<Number, 'a>", vars: 0 });
  expectBinding(result.env, "quotient", { type: "Result<Number, 'a>", vars: 0 });
  expectBinding(result.env, "negated", { type: "Result<Number, 'a>", vars: 0 });
  expectBinding(result.env, "inverted", { type: "Result<Bool, 'a>", vars: 0 });
  expectBinding(result.env, "liftedCall", { type: "Result<Number, 'a>", vars: 0 });
});

Deno.test("explicit carrier tuple lift infers over Result", async () => {
  const result = await checkSource(`
    let pair = Result|Ok(1), Ok("a")|;
    let triple = Result|Ok(1), Ok("a"), Ok(true)|;
  `);

  expectBinding(result.env, "pair", { type: "Result<(Number, String), 'a>", vars: 0 });
  expectBinding(result.env, "triple", {
    type: "Result<(Number, String, Bool), 'a>",
    vars: 0,
  });
});

Deno.test("low-level inference starts from minimal basis without std combinators", async () => {
  const module = await parse("let value = Option.map;");
  assertThrows(() => inferModule(module), Error, "unknown name Option.map");
});

Deno.test("Result and Option combinators evaluate correctly", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let parseAge = (n) => {
        if (n < 0) { Err("negative") } else { Ok(n) }
      };
      let main = () => {
        print(parseAge(21) :> Result.map((n) => { n * 2 }));
        print(parseAge(21) :> Result.andThen((n) => { parseAge(n - 50) })
          :> Result.mapErr((e) => { "bad: " ++ e }));
        print(parseAge(0 - 1) :> Result.withDefault(0));
        print(Some(3) :> Option.map((n) => { n + 1 }) :> Option.andThen((n) => {
          if (n > 3) { Some(n) } else { None }
        }) :> Option.withDefault(0));
        print(None :> Option.withDefault(9));
        print([1, 2, 3] :> List.map((n) => { n + 1 }));
        print([Ok(1), Ok(2), Ok(3)] :> Result.collectList);
        print([Some(1), Some(2), Some(3)] :> Option.collectList);
        print([1, 2, 3] :> Result.traverse((n) => {
          if (n > 0) { Ok(n * 2) } else { Err(Panic("bad")) }
        }) :> Result.map(Js.Array.fromList));
        print(JSON[1, 2, 3] :> Json.assert :> Result.andThen((items) => {
          items :> Js.Array.toList :> Result.traverse((n) => {
            if (n > 0) { Ok(n * 2) } else { Err(Panic("bad")) }
          }) :> Result.map(Js.Array.fromList)
        }) :> Result.mapErr((err) => { "bad" }));
        Err("bad") :> Task.fromResult :> Task.recover((_) => { 2 })
          :> Task.andThen((n) => {
            print(n + 1);
            [Task.succeed(1), Task.succeed(2), Task.succeed(3)]
              :> Task.collectList
              :> Task.map((items) => {
                print(items);
                void
              })
          })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(
    result.stdout,
    "Ok(42)\nErr(bad: negative)\n0\n4\n9\nCons(2, Cons(3, Cons(4, Nil)))\nOk(Cons(1, Cons(2, Cons(3, Nil))))\nSome(Cons(1, Cons(2, Cons(3, Nil))))\nOk([2, 4, 6])\nOk([2, 4, 6])\n3\nCons(1, Cons(2, Cons(3, Nil)))\n",
  );
});

Deno.test("Result carrier coercion evaluates through primitive operators", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let liftR = Monad.lift Result;
      let keepNumber = liftR (n) => {
        Ok(n)
      };

      let main = () => {
        print(Ok(2) + 3);
        print(3 * Ok(4));
        print(Ok(8) / Ok(2));
        print(-Ok(4));
        print(!Ok(false));
        print(keepNumber((Ok(9) - 1) / 2));
        print(Err("left") + Ok(3));
        print(Ok(2) + Err("right"))
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(
    result.stdout,
    "Ok(5)\nOk(12)\nOk(4)\nOk(-4)\nOk(true)\nOk(4)\nErr(left)\nErr(right)\n",
  );
});

Deno.test("explicit carrier tuple lift evaluates through Result", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let main = () => {
        print(Result|Ok(1), Ok("a"), Ok(true)|);
        print(Result|Ok(1), Err("bad"), Ok(true)|)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "Ok(1, a, true)\nErr(bad)\n");
});

Deno.test("Task.collectList supports list-pattern destructuring in map callback", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let fetchUser = () => {
        Task.succeed("user")
      };

      let fetchPosts = () => {
        Task.succeed("posts")
      };

      let render = (user, posts) => {
        user ++ "/" ++ posts
      };

      let main = () => {
        let pageTask = [
          fetchUser(),
          fetchPosts(),
        ] :> Task.collectList
          :> Task.map(([user, posts]) => {
            render(user, posts)
          });

        pageTask :> Task.map(print)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "user/posts\n");
});

Deno.test("Task.collectList can map a named list-pattern function", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let fetchProfile = () => {
        Task.succeed("profile")
      };

      let fetchSettings = () => {
        Task.succeed("settings")
      };

      let render = (profile, settings) => {
        profile ++ "/" ++ settings
      };

      let renderPage = ([profile, settings]) => {
        render(profile, settings)
      };

      let loadPage = () => {
        let [profileTask, settingsTask] = [
          fetchProfile(),
          fetchSettings(),
        ];

        [profileTask, settingsTask]
          :> Task.collectList
          :> Task.map(renderPage)
      };

      let main = () => {
        loadPage() :> Task.map(print)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "profile/settings\n");
});

Deno.test("Task.map2 supports fixed task composition through pipe rules", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let fetchProfile = () => {
        Task.succeed("profile")
      };

      let fetchSettings = () => {
        Task.succeed("settings")
      };

      let render = (profile, settings) => {
        profile ++ "/" ++ settings
      };

      let renderPage = () => {
        let [profileTask, settingsTask] = [
          fetchProfile(),
          fetchSettings(),
        ];

        profileTask
          :> Task.map2(settingsTask, render)
      };

      let main = () => {
        renderPage() :> Task.map(print)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "profile/settings\n");
});

Deno.test("lifted Task tuple syntax sequences task values into one tuple task", async () => {
  const result = await checkSource(`
    let render = Monad.lift Task (text, title) => {
      Task.succeed(text ++ "/" ++ title)
    };
    let text = Task.succeed("README.md");
    let title = Task.succeed("# wm-mini");
    let tupled = |text, title|;
    let page = render(tupled);
  `);

  expectBinding(result.env, "render", {
    type: "(Task<(String, String), 'a>) => Task<String, 'a>",
    vars: 0,
  });
  expectBinding(result.env, "tupled", { type: "Task<(String, String), 'a>", vars: 0 });
  expectBinding(result.env, "page", { type: "Task<String, 'a>", vars: 0 });
});

Deno.test("lifted Task tuple syntax evaluates through Task.andThen and Task.map", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let readFile = Monad.lift Task (path) => {
        Task.succeed("text:" ++ path)
      };

      let titlePrefix = Monad.lift Task (text) => {
        Task.succeed("title:" ++ text)
      };

      let render = Monad.lift Task (text, title) => {
        Task.succeed(text ++ "/" ++ title)
      };

      let main = () => {
        let path = Task.succeed("README.md");
        let text = readFile(path);
        let title = titlePrefix(text);

        render(|text, title|)
          :> Task.map(print)
      };
    `,
  );

  const output = await runCli(["run", input]);

  assertEquals(output.stderr, "");
  assertEquals(output.code, 0);
  assertEquals(output.stdout, "text:README.md/title:text:README.md\n");
});

Deno.test("Task.fn evaluates lifted fect-style composition", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      record User = { login: String, name: String };

      let fetchUser = Monad.lift Task (login) => {
        .{ login = login, name = login ++ " Lovelace" } :> Task.succeed
      };

      let getDisplayName = Monad.lift Task (user) => {
        user.name :> Task.succeed
      };

      let main = () => {
        "Ada"
          :> Task.succeed
          :> fetchUser
          :> getDisplayName
          :> Task.map(print)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "Ada Lovelace\n");
});

Deno.test("Task.fn composes real async JS tasks", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      from js.global("Deno") import { readTextFile };

      let readFile = Monad.lift Task (path) => {
        readTextFile(path) :> Task.mapErr((_) => { "could not read " ++ path })
      };

      let titlePrefix = Monad.lift Task (text) => {
        text
          :> .slice(0, 9)
          :> Result.mapErr((_) => { "could not slice title" })
          :> Task.fromResult
      };

      let main = () => {
        "README.md"
          :> Task.succeed
          :> readFile
          :> titlePrefix
          :> Task.map(print)
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "# wm-mini\n");
});

async function runCli(args: string[]) {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, ...args],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
