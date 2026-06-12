import { assertEquals } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
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
    let traversed = JSON[1, 2, 3] :> Json.assert :> Result.andThen((items) => {
      items :> Result.traverse((n) => {
        if (n > 0) { Ok(n * 2) } else { Err(Panic("bad")) }
      })
    });
    let task = Err("bad") :> Task.fromResult :> Task.recover((_) => { 2 })
      :> Task.andThen((n) => { Task.succeed(n + 1) });
    let taskItems = JSON[1, 2] :> Json.assert :> Result.mapErr((_) => { "json" })
      :> Task.fromResult
      :> Task.andThen((items) => {
        items :> Task.traverse((n) => { Task.succeed(n * 2) })
      });
  `);
  expectBinding(result.env, "doubled", { type: "Result<Number, String>", vars: 0 });
  expectBinding(result.env, "chained", { type: "Result<Number, String>", vars: 0 });
  expectBinding(result.env, "fallback", { type: "Number", vars: 0 });
  expectBinding(result.env, "opt", { type: "Option<Number>", vars: 0 });
  expectBinding(result.env, "plain", { type: "Number", vars: 0 });
  expectBinding(result.env, "traversed", { type: "Result<Js.Array<Number>, Js.Error>", vars: 0 });
  expectBinding(result.env, "task", { type: "Js.Promise<Result<Number, String>>", vars: 0 });
  expectBinding(result.env, "taskItems", {
    type: "Js.Promise<Result<Js.Array<Number>, String>>",
    vars: 0,
  });
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
        print(JSON[1, 2, 3] :> Json.assert :> Result.andThen((items) => {
          items :> Result.traverse((n) => {
            if (n > 0) { Ok(n * 2) } else { Err(Panic("bad")) }
          })
        }) :> Result.mapErr((err) => { "bad" }));
        Err("bad") :> Task.fromResult :> Task.recover((_) => { 2 })
          :> Task.andThen((n) => {
            print(n + 1);
            Task.succeed(void)
          })
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "Ok(42)\nErr(bad: negative)\n0\n4\n9\nOk([2, 4, 6])\n3\n");
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
