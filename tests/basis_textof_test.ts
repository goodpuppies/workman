import { assertEquals } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { expectBinding } from "./type_helpers.ts";

const cli = new URL("../src/main.ts", import.meta.url).pathname;

Deno.test("Text.of infers as a polymorphic text helper", async () => {
  const result = await checkSource(`
    let numberText = Text.of(42);
    let boolText = Text.of(true);
  `);

  expectBinding(result.env, "numberText", { type: "String", vars: 0 });
  expectBinding(result.env, "boolText", { type: "String", vars: 0 });
});

Deno.test("Text.of evaluates through JS toString with fallback", async () => {
  const dir = await Deno.makeTempDir();
  const input = `${dir}/main.wm`;
  await Deno.writeTextFile(
    input,
    `
      let main = () => {
        print(Text.of(42));
        print(Text.of(void))
      };
    `,
  );

  const result = await runCli(["run", input]);

  assertEquals(result.stderr, "");
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "42\n?\n");
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
