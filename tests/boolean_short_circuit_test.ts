import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));

async function run(source: string) {
  const dir = await Deno.makeTempDir({ prefix: "wm-short-circuit-" });
  try {
    await Deno.writeTextFile(`${dir}/m.wm`, source);
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

const traced = `
  let t = (name, value) => { print(name); value };
`;

Deno.test("the right operand runs only when the left one doesn't decide", async () => {
  const stdout = await run(`${traced}
    let main = () => {
      print(t("a", false) && t("skipped", true));
      print(t("b", true) || t("skipped", false));
      print(t("c", true) && t("d", false));
      print(t("e", false) || t("f", true));
    };
  `);
  assertEquals(
    stdout,
    "a\nfalse\nb\ntrue\nc\nd\nfalse\ne\nf\ntrue\n",
  );
});

Deno.test("sequential operators follow their precedence", async () => {
  const stdout = await run(`${traced}
    let main = () => {
      print(t("a", true) || t("skipped", false) && t("skipped", false));
      print(t("b", false) && t("skipped", true) || t("c", true));
      print((t("d", true) || t("skipped", false)) && t("e", false));
    };
  `);
  assertEquals(stdout, "a\ntrue\nb\nc\ntrue\nd\ne\nfalse\n");
});

Deno.test("a guard protects the operation on its right", async () => {
  const stdout = await run(`
    let safe = (n, total) => { n != 0 && Panic("divide") };
    let main = () => { print(safe(0, 10)) };
  `);
  assertEquals(stdout, "false\n");
});

Deno.test("the right operand is in tail position", async () => {
  const stdout = await run(`
    let rec anyDown = (n) => { n == 0 || anyDown(n - 1) };
    let rec allDown = (n) => { n == 0 || (n > 0 && allDown(n - 1)) };
    let main = () => {
      print(anyDown(1000000));
      print(allDown(1000000));
    };
  `);
  assertEquals(stdout, "true\ntrue\n");
});

Deno.test("sequential operators keep their Bool type and require Bool operands", async () => {
  const result = await checkSource(`
    let both = (a, b) => { a && b };
    let either = (a, b) => { a || b };
  `);
  expectBinding(result.env, "both", { type: "(Bool, Bool) -> Bool", vars: 0 });
  expectBinding(result.env, "either", { type: "(Bool, Bool) -> Bool", vars: 0 });
});
