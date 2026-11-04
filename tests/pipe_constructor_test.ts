import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function run(files: Record<string, string>) {
  const dir = await Deno.makeTempDir({ prefix: "wm-pipe-constructor-" });
  try {
    for (const [name, text] of Object.entries(files)) {
      await Deno.writeTextFile(`${dir}/${name}`, text);
    }
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", main, "run", "m.wm"],
      cwd: dir,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    assertEquals(output.code, 0, decode(output.stderr));
    return decode(output.stdout);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("constructors work as pipe stages", async () => {
  const stdout = await run({
    "lib.wm": `type Shape = | Circle<Number>;`,
    "m.wm": `
      from "./lib.wm" import * as Lib;
      type Color = | Paint<Number>;
      let wrap = value => value :> Some;
      let shown = (color) => { match(color) { Paint(n) => { n } } };
      let radius = (shape) => { match(shape) { Lib.Circle(n) => { n } } };
      let main = () => {
        print(wrap(1) :> getOr(0));
        print(match(2 :> Ok) { Ok(n) => { n }, Err(_) => { 0 } });
        print(match(3 :> Err) { Ok(_) => { 0 }, Err(n) => { n } });
        print(4 :> Paint :> shown);
        print(5 :> Lib.Circle :> radius);
        print(match(6 :> Some :> Some) { Some(Some(n)) => { n }, _ => { 0 } })
      };
    `,
  });
  assertEquals(stdout, "1\n2\n3\n4\n5\n6\n");
});
