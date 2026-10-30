// Reproduce the open generic-foreign-identity bug without fetching Effect.
// deno run -A scripts/probe_ffi_generic_identity.ts
// Add --assert-expected to fail on the known compiler discrepancies.
import { fileURLToPath } from "node:url";
import { checkSource } from "../src/compiler.ts";
import { show } from "../src/types.ts";

const path = fileURLToPath(new URL("../generic_identity_probe.wm", import.meta.url));
const fixture = "./tests/fixtures/ffi_generic_box.ts";
let failures = 0;

async function probe(
  label: string,
  source: string,
  expected: Record<string, string>,
) {
  try {
    const checked = await checkSource(source, {}, path);
    const actual = Object.fromEntries(
      Object.keys(expected).map((name) => {
        const binding = checked.env.get(name);
        return [name, binding ? show(binding.type) : "<missing>"];
      }),
    );
    const passed = Object.entries(expected).every(([name, type]) => actual[name] === type);
    if (!passed) failures++;
    console.log(JSON.stringify({ label, passed, expected, actual }));
  } catch (error) {
    failures++;
    console.log(JSON.stringify({
      label,
      passed: false,
      expected,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

// A single monomorphic numeric factory is the control. Adding an unused factory
// of the same nominal generic interface must not change the numeric field's type.
for (
  const clause of [
    "unsafe { numberBox }",
    "unsafe { numberBox, stringBox }",
    "unsafe { stringBox, numberBox }",
    "unsafe * as Box",
  ]
) {
  const call = clause.includes("*") ? "Box.numberBox()" : "numberBox()";
  await probe(
    clause,
    `
    from js.module("${fixture}") import ${clause};
    let boxed = ${call};
    let value = boxed :> .value;
  `,
    { value: "Result<Number, Js.Error>" },
  );
}

const header = `from js.module("${fixture}") import unsafe * as Box;`;
await probe(
  "generic payloads",
  `${header}
  let numberBox = Box.succeed(20);
  let stringBox = Box.succeed("hello");
  let numberValue = Box.run(numberBox);
  let stringValue = Box.run(stringBox);
`,
  { numberValue: "Number", stringValue: "String" },
);

await probe(
  "tuple callback",
  `${header}
  let grouped = Box.flatMap(Box.succeed(1), (number) => {
    Box.map(Box.succeed("hello"), (text) => { (number, text) })
  });
  let value = Box.run(grouped);
`,
  { value: "(Number, String)" },
);

console.log(`${failures} probe(s) differ from the intended types.`);
if (failures && Deno.args.includes("--assert-expected")) Deno.exit(1);
