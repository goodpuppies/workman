import { assertEquals } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const cli = new URL("../src/main.ts", import.meta.url).pathname;

Deno.test("persistent Map infers generic key and value types", async () => {
  const result = await checkSource(`
    let numbers = Map.empty(Map.numberCompare)
      :> Map.set(2, "two")
      :> Map.set(1, "one");
    let found = Map.get(numbers, 2);
    let present = Map.has(numbers, 1);
    let pairs = Map.toList(numbers);
    let total = Map.fold(numbers, 0, (sum, key, _) => { sum + key });
  `);

  expectBinding(result.env, "numbers", { type: "Map<Number, String>", vars: 0 });
  expectBinding(result.env, "found", { type: "Option<String>", vars: 0 });
  expectBinding(result.env, "present", { type: "Bool", vars: 0 });
  expectBinding(result.env, "pairs", {
    type: "List<(Number, String)>",
    vars: 0,
  });
  expectBinding(result.env, "total", { type: "Number", vars: 0 });
});

Deno.test("persistent Map preserves old versions and ordered semantics", async () => {
  const source = `
    let main = () => {
      let original = Map.fromList(Map.numberCompare, [(3, "three"), (1, "one"), (2, "two")]);
      let replaced = Map.set(original, 2, "TWO");
      let removed = Map.remove(replaced, 1);
      let inserted = Map.update(removed, 4, (_) => { Some("four") });
      let deleted = Map.update(inserted, 3, (_) => { None });
      print(Map.get(original, 2));
      print(Map.get(replaced, 2));
      print(Map.has(original, 4));
      print(Map.toList(inserted));
      print(Map.toList(deleted))
    };
  `;

  const result = await runSource(source);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stderr, "");
  assertEquals(
    result.stdout,
    "Some(two)\nSome(TWO)\nfalse\nCons((2, TWO), Cons((3, three), Cons((4, four), Nil)))\nCons((2, TWO), Cons((4, four), Nil))\n",
  );
});

Deno.test("persistent Map AVL height stays logarithmic for sorted inserts", async () => {
  const source = `
    let rec fill = match(map, next, limit) => {
      (map, next, limit) => {
        if (next > limit) {
          map
        } else {
          fill(Map.set(map, next, next), next + 1, limit)
        }
      }
    };
    let main = () => {
      print(fill(Map.empty(Map.numberCompare), 1, 2048) :> Map.debugHeight)
    };
  `;

  const result = await runSource(source);
  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stderr, "");
  assertEquals(Number(result.stdout.trim()) <= 12, true);
});

async function runSource(source: string) {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(input, source);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, "run", input],
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
