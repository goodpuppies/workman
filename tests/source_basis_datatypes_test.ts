import { assertEquals, assertThrows } from "@std/assert";
import { sourceBasisDatatypes } from "../scripts/source_basis_datatypes.ts";
import { SOURCE_BASIS_DATATYPES } from "../src/generated/source_basis_datatypes.ts";
import { librarySources } from "../src/generated/assets.ts";

const grammar = await Deno.readTextFile(new URL("../src/grammar.peggy", import.meta.url));

Deno.test("source Basis constructor descriptors reproduce the packaged artifact", () => {
  assertEquals(sourceBasisDatatypes(grammar, librarySources), SOURCE_BASIS_DATATYPES);
});

Deno.test("Basis source owns constructor names, payloads and runtime spellings", () => {
  const sources = {
    ...librarySources,
    "subml-basis/subset_option_value.wm":
      "// @basis-type Option\ntype Option<value> = Absent | Present<List<value>>;",
  };
  const option = sourceBasisDatatypes(grammar, sources).find((type) => type.name === "Option")!;
  assertEquals(option.argLabels, ["value"]);
  assertEquals(option.constructors, [
    { name: "Absent", id: -1, args: [], runtimeName: "__wm_basis_Absent" },
    {
      name: "Present",
      id: -2,
      runtimeName: "__wm_basis_Present",
      args: [{
        kind: "TName",
        name: "List",
        path: { qualifiers: [], id: "List" },
        args: [{ kind: "TName", name: "value", args: [] }],
      }],
    },
  ]);
});

Deno.test("Basis lang items reject missing source directives and incompatible arity", () => {
  for (
    const source of [
      "type Result<a, e> = Ok<a> | Err<e>;",
      "// @basis-type Result\ntype Result<a> = Ok<a>;",
    ]
  ) {
    assertThrows(() =>
      sourceBasisDatatypes(grammar, {
        ...librarySources,
        "subml-basis/subset_result_value.wm": source,
      })
    );
  }
});

Deno.test("source constructors cannot collide with another Basis type's stable identities", () => {
  assertThrows(
    () =>
      sourceBasisDatatypes(grammar, {
        ...librarySources,
        "subml-basis/subset_option_value.wm":
          "// @basis-type Option\ntype Option<a> = None | Some<a> | Extra;",
      }),
    Error,
    "constructor identity allocation exhausted for Option",
  );
});
