import { assertEquals, assertRejects } from "@std/assert";
import { checkSource, compile } from "../src/compiler.ts";

Deno.test("JSON literals accept Js.Array values whose elements are JSON-compatible", async () => {
  await checkSource(`
    record Row = { name: String, x: Number };
    let rowJson = (row: Row) => { JSON{ name: row.name, x: row.x } };
    let document = JSON{
      names: Js.Array.fromList(["a", "b"]),
      counts: Js.Array.fromList([1, 2]),
      rows: Js.Array.fromList([rowJson(Row { name = "a", x = 1 })]),
      nested: JSON[Js.Array.fromList([true])]
    };
  `);

  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const javaScript = await compile(`
      from js.global("JSON") import { stringify: Js.Value -> String } as JSON;
      let main = () => {
        match(JSON.stringify(JSON{ counts: Js.Array.fromList([1, 2]) })) {
          Ok(text) => { print(text) },
          Err(_) => { print("stringify failed") }
        }
      };
    `);
    await import(`data:text/javascript;base64,${btoa(javaScript)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ['{"counts":[1,2]}']);
});

Deno.test("JSON literals still reject Js.Array values with non-JSON elements", async () => {
  await assertRejects(
    () =>
      checkSource(`
        let document = JSON{ fs: Js.Array.fromList([(x) => { x + 1 }]) };
      `),
    Error,
    "vs \"Js.Value\"",
  );
});
