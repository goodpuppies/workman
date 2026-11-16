import { assertEquals, assertStrictEquals } from "@std/assert";
import { BASIS_OPERATORS, BASIS_TYPES, BASIS_UNARY_OPERATORS } from "../src/basis_manifest.ts";
import { parseLongId } from "../src/ast.ts";
import { basisCtorId, basisCtorJsName } from "../src/basis.ts";
import { BASIS_TYPE_NAME_IDS, GPU_SEMANTIC_IDS } from "../src/compiler_semantics.ts";
import { checkSource, compile, compileLibraryVirtual } from "../src/compiler.ts";
import { lookupLongValue } from "../src/infer/environment.ts";
import type { StaticEnv } from "../src/infer/environment.ts";
import { BASIS_PROFILES, initialBasis } from "../src/initial_basis.ts";
import { loadStandardModules } from "../src/standard_library.ts";
import { expectBinding } from "./type_helpers.ts";
import { importProgram } from "./import_program.ts";

// `Real64.Real` and `Int32.Int` are primitives too, bound in their `Real64` and `Int32` structures.
const primitiveTypes = [
  "Bool",
  "String",
  "Void",
  "Char",
];

const jsTypes = [
  "Js.Value",
  "Js.Object",
  "Js.Array",
  "Js.ArrayLike",
  "Js.Dict",
  "Js.Table",
];

const gpuTypes = [
  "Gpu.Color",
  "Gpu.Fragment",
  "Gpu.Uniform",
  "Gpu.Texture2D",
  "Gpu.SampledTexture2D",
  "Gpu.RenderTarget2D",
  "Gpu.Sampler",
  "Gpu.ShaderTarget",
];

const fixedOperators = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "++",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
];

Deno.test("[module update T130] current no-prelude static interface is explicit", () => {
  const basis = initialBasis(BASIS_PROFILES.kernel).instantiate();
  const { tyEnv: typeEnv, valEnv: env } = basis.environment;

  assertEquals([...typeEnv.keys()], primitiveTypes);
  // The JS FFI vocabulary is default-profile only (BD17).
  assertEquals(basis.environment.strEnv.get("Js"), undefined);
  assertEquals(
    [...basis.environment.strEnv.get("Gpu")!.tyEnv.keys()],
    gpuTypes.map((name) => name.slice("Gpu.".length)),
  );
  assertEquals([...env.keys()], ["print"]);
  assertEquals([...basis.operators.keys()], fixedOperators);
});

Deno.test("[module update T130/T132] current default low-level basis type interface is explicit", () => {
  const typeEnv = initialBasis(BASIS_PROFILES.default).instantiate().environment.tyEnv;
  assertEquals([...typeEnv].map(([name, info]) => [name, info.arity]), [
    ...primitiveTypes.map((name) => [name, 0]),
    ["Option", 1],
    ["Result", 2],
    ["List", 1],
    ["Task", 2],
    ["Ptr", 1],
    ["Opaque", 0],
    ["CStorage", 1],
  ]);
  assertEquals(
    [...initialBasis(BASIS_PROFILES.default).instantiate().environment.strEnv.get("Js")!.tyEnv
      .keys()],
    [...jsTypes.map((name) => name.slice("Js.".length)), "Error"],
  );
});

Deno.test("[module update T130/T133] current default constructors and low-level members are explicit", () => {
  const basis = initialBasis(BASIS_PROFILES.default).instantiate();
  const { valEnv: env } = basis.environment;

  assertEquals(
    [...env]
      .filter(([, scheme]) => scheme.status === "constructor")
      .map(([name]) => name),
    ["None", "Some", "Ok", "Err", "Nil", "Cons"],
  );
  assertEquals(
    [...env]
      .filter(([, scheme]) => scheme.status !== "constructor")
      .map(([name]) => name),
    ["print"],
  );
  assertEquals(
    [...basis.environment.strEnv.get("Result")!.valEnv.keys()],
    ["Ok", "Err"],
  );
  // Task's operations are defined in std/task.wm; only the type is compiler-owned.
  assertEquals(basis.environment.strEnv.get("Task"), undefined);
  assertEquals(
    [...basis.environment.strEnv.get("Js")!.strEnv.get("Array")!.valEnv.keys()],
    ["toList", "fromList"],
  );
  // Host helpers are `host/js/` library modules behind `js.host` imports (BD17).
  for (const name of ["Dict", "Table", "Bytes", "Debug"]) {
    assertEquals(basis.environment.strEnv.get(name), undefined);
  }
  assertEquals([...basis.operators.keys()], fixedOperators);
});

Deno.test("[module update B301] initial basis instances cannot mutate the cached definition", () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const first = artifact.instantiate();
  first.environment.valEnv.clear();
  first.environment.strEnv.get("Gpu")?.valEnv.clear();
  first.operators.clear();

  const second = artifact.instantiate();

  assertEquals(second.environment.valEnv.has("print"), true);
  assertEquals(second.environment.strEnv.get("Gpu")?.valEnv.has("fragment"), true);
  assertEquals(second.operators.has("+"), true);
});

Deno.test("[module update B309] pervasive bindings come from the explicit profile table", () => {
  assertEquals(
    initialBasis(BASIS_PROFILES.kernel).pervasiveBindings.map((binding) => binding.target),
    ["print"],
  );
  assertEquals(
    initialBasis(BASIS_PROFILES.default).pervasiveBindings.map((binding) => binding.target),
    ["print", "None", "Some", "Ok", "Err", "Nil", "Cons"],
  );
});

Deno.test("[module update B302/B314/B318/T132] basis facts own type and intrinsic identity", () => {
  const facts = initialBasis(BASIS_PROFILES.default).facts;

  assertEquals(
    facts.types.map((type) => [type.name, type.typeNameId]),
    BASIS_TYPES.map((type) => [type.name, BASIS_TYPE_NAME_IDS[type.name]]),
  );
  assertEquals(
    new Set(facts.types.map((type) => type.typeNameId)).size,
    facts.types.length,
  );
  assertEquals(
    facts.intrinsics.map((intrinsic) => intrinsic.semanticId).sort(),
    Object.values(GPU_SEMANTIC_IDS).sort(),
  );
});

Deno.test("[module update B302/B318/T133] constructor facts agree with ValEnv status", () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const basis = artifact.instantiate();

  for (const constructor of artifact.facts.constructors) {
    assertEquals(constructor.status, "constructor");
    assertEquals(constructor.id, basisCtorId(constructor.name));
    const pervasive = artifact.pervasiveBindings.find((binding) =>
      binding.source === `${constructor.typeName}.${constructor.name}`
    );
    if (!pervasive) continue;
    assertEquals(basis.environment.valEnv.get(pervasive.target)?.status, "constructor");
  }
});

Deno.test("[module update B309/T134] pervasive constructors project the structure member", () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const basis = artifact.instantiate();

  for (const binding of artifact.pervasiveBindings.filter((item) => item.source.includes("."))) {
    const member = lookupLongValue(basis.environment.strEnv, parseLongId(binding.source));
    const pervasive = basis.environment.valEnv.get(binding.target);
    if (!member || !pervasive) throw new Error(`missing pervasive projection ${binding.target}`);
    assertStrictEquals(pervasive, member);
  }
});

Deno.test("[module update B304] fixed operators type expressions without ValEnv bindings", async () => {
  const result = await checkSource("let value = 1 + 2;");

  expectBinding(result.env, "value", { type: "Int32.Int", vars: 0 });
  assertEquals(result.env.has("+"), false);
});

Deno.test("[module update B302/T135] fixed operator static and runtime catalogs agree", async () => {
  assertEquals(
    initialBasis(BASIS_PROFILES.default).facts.operators.map((operator) => operator.spelling),
    BASIS_OPERATORS.map((operator) => operator.spelling),
  );
  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    const compiled = await compile("let main = () => { print((1 + 2) * 3 == 9) };");
    await importProgram(`data:text/javascript;base64,${btoa(compiled)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["true"]);
});

Deno.test("[module update T131/G9] every initial static value has an implementation fact", async () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const basis = artifact.instantiate();
  const implemented = new Set([
    ...artifact.facts.values.map((value) => value.exportName),
    ...artifact.facts.intrinsics.map((intrinsic) => intrinsic.exportName),
    ...artifact.facts.constructors.map((constructor) =>
      constructor.name.includes(".")
        ? constructor.name
        : `${constructor.typeName}.${constructor.name}`
    ),
    ...artifact.pervasiveBindings.map((binding) => binding.target),
  ]);
  assertEquals(
    collectStaticValues(basis.environment).filter((name) => !implemented.has(name)),
    [],
  );

  const runtimeReferences = [
    ...artifact.facts.values.map((value) => value.exportName),
    ...artifact.facts.intrinsics.flatMap((intrinsic) =>
      intrinsic.runtimeName ? [intrinsic.exportName] : []
    ),
    ...artifact.facts.constructors.map((constructor) =>
      constructor.name.includes(".")
        ? constructor.name
        : `${constructor.typeName}.${constructor.name}`
    ),
  ];
  const compiled = await compile(`let runtimeFacts = (${runtimeReferences.join(", ")});`);
  await importProgram(`data:text/javascript;base64,${btoa(compiled)}#${crypto.randomUUID()}`);
});

Deno.test("[module update T136/B305] pervasive print is an ordinarily shadowable value", async () => {
  const result = await checkSource(`
    let print = (value) => { value + 1 };
    let answer = print(41);
  `);

  expectBinding(result.env, "answer", { type: "Int32.Int", vars: 0 });
});

function collectStaticValues(environment: StaticEnv, prefix = ""): string[] {
  return [
    ...[...environment.valEnv.keys()].map((name) => `${prefix}${name}`),
    ...[...environment.strEnv].flatMap(([name, nested]) =>
      collectStaticValues(nested, `${prefix}${name}.`)
    ),
  ];
}

Deno.test("[module update T137/B317] standard-basis construction is deterministic and effect-free", async () => {
  const source = 'let main = () => { print("user") };';
  const first = await compile(source);
  const second = await compile(source);
  assertEquals(second, first);

  const output: string[] = [];
  const original = console.log;
  console.log = (value) => output.push(String(value));
  try {
    await importProgram(`data:text/javascript;base64,${btoa(first)}#${crypto.randomUUID()}`);
  } finally {
    console.log = original;
  }
  assertEquals(output, ["user"]);
});

Deno.test("[module update T130] current compiled standard structure interfaces are explicit", async () => {
  const modules = await loadStandardModules();
  assertEquals(
    modules.filter((module) => !module.alias.startsWith("Subset")).map((module) => ({
      alias: module.alias,
      values: [...module.result.exportedStructure.valEnv.keys()],
      types: [...module.result.exportedStructure.tyEnv.keys()],
    })),
    [
      {
        alias: "Bytes",
        values: [
          "readFile",
          "readSlice",
          "writeFile",
        ],
        types: [],
      },
      {
        alias: "Debug",
        values: [
          "errorMessage",
        ],
        types: [],
      },
      {
        alias: "Dict",
        values: [
          "empty",
          "get",
          "set",
        ],
        types: [],
      },
      {
        alias: "Table",
        values: [
          "empty",
          "get",
          "set",
          "getAt",
          "setAt",
          "remove",
          "removeAt",
        ],
        types: [],
      },
      {
        alias: "Basis",
        values: [
          "Empty",
          "Subscript",
          "Chr",
          "Domain",
          "Option",
          "UnequalLengths",
          "Unordered",
          "Fail",
        ],
        types: [
          "Error",
        ],
      },
      {
        alias: "Byte",
        values: [
          "bytesToString",
          "stringToBytes",
        ],
        types: [],
      },
      {
        alias: "Real32",
        values: [
          "fromReal64",
          "toReal64",
          "add",
          "sub",
          "mul",
          "div",
          "neg",
        ],
        types: [
          "Real",
          "Self",
        ],
      },
      {
        alias: "PackReal32Big",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackReal32Little",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackReal64Big",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackReal64Little",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackWord16Big",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackWord16Little",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackWord32Big",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackWord32Little",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackWord64Big",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "PackWord64Little",
        values: [
          "bytesPerElem",
          "isBigEndian",
          "subVec",
          "subSlice",
          "pack",
        ],
        types: [],
      },
      {
        alias: "Word8",
        values: [
          "wordSize",
          "fromReal64",
          "toReal64",
          "andb",
          "orb",
          "xorb",
          "notb",
          "shiftLeft",
          "shiftRight",
          "shiftRightArithmetic",
          "add",
          "sub",
          "mul",
          "div",
          "mod",
        ],
        types: [
          "Word",
          "Self",
        ],
      },
      {
        alias: "Word8VectorSlice",
        values: [
          "full",
          "slice",
          "subslice",
          "base",
          "length",
          "isEmpty",
          "sub",
          "vector",
          "concat",
        ],
        types: [
          "Slice",
        ],
      },
      {
        alias: "Binary",
        values: [
          "Bounds",
          "UnterminatedAscii",
          "Cursor",
          "bounds",
          "take",
          "readFirst",
          "u8",
          "u16le",
          "u16be",
          "u32le",
          "u32be",
          "u64le",
          "u64be",
          "f32le",
          "f32be",
          "f64le",
          "f64be",
          "asciiZ",
          "cursor",
          "cursorAt",
          "position",
          "remaining",
          "skip",
          "readU8",
          "readU16le",
          "readU16be",
          "readU32le",
          "readU32be",
          "readU64le",
          "readU64be",
          "readF32le",
          "readF32be",
          "readF64le",
          "readF64be",
        ],
        types: [
          "Error",
          "Cursor",
        ],
      },
      {
        alias: "General",
        values: [
          "o",
          "before",
          "ignore",
        ],
        types: [],
      },
      {
        alias: "OptionValue",
        values: [
          "None",
          "Some",
        ],
        types: [
          "Option",
        ],
      },
      {
        alias: "Result",
        values: [
          "None",
          "Some",
          "Ok",
          "Err",
          "map",
          "mapErr",
          "andThen",
          "via",
          "viaError",
          "getOr",
          "isOk",
          "toOption",
        ],
        types: [
          "Option",
          "Result",
        ],
      },
      {
        alias: "List",
        values: [
          "None",
          "Some",
          "EmptyList",
          "InvalidCount",
          "InvalidIndex",
          "OutOfBounds",
          "isEmpty",
          "reverseAppend",
          "reverse",
          "append",
          "foldLeft",
          "foldRight",
          "concat",
          "forEach",
          "map",
          "filterMap",
          "filter",
          "partition",
          "find",
          "exists",
          "all",
          "length",
          "dropWhile",
          "validCount",
          "repeat",
          "splitAt",
          "at",
          "take",
          "drop",
          "tabulate",
          "head",
          "tail",
          "last",
          "traverse",
        ],
        types: [
          "Option",
          "Error",
        ],
      },
      {
        alias: "Bool",
        values: [
          "not",
        ],
        types: [],
      },
      {
        alias: "Order",
        values: [
          "Less",
          "Equal",
          "Greater",
          "Unordered",
          "compareInt",
          "compareReal",
          "reverse",
        ],
        types: [
          "Order",
          "Error",
        ],
      },
      {
        alias: "Char",
        values: [
          "NonAscii",
          "NonByteCharacter",
          "InvalidCode",
          "byteChars",
          "toCode",
          "fromCode",
          "member",
          "contains",
          "isLowerChars",
          "isLower",
          "isUpperChars",
          "isUpper",
          "isDigitChars",
          "isDigit",
          "isGraphChars",
          "isGraph",
          "isPrintChars",
          "isPrint",
          "isCntrlChars",
          "isCntrl",
          "isAsciiChars",
          "isAscii",
          "isSpaceChars",
          "isSpace",
          "isAlpha",
          "isAlphaNum",
          "isHexDigit",
          "isPunct",
          "compareAscii",
          "upper",
          "lower",
          "convert",
          "toLower",
          "toUpper",
        ],
        types: [
          "Error",
        ],
      },
      {
        alias: "Bytes",
        values: [
          "None",
          "Some",
          "InvalidIndex",
          "OutOfBounds",
          "NonByte",
          "Reader",
          "validate",
          "compareWith",
          "compare",
          "length",
          "trim",
          "fields",
          "isPrefix",
          "isSuffix",
          "isSubstring",
          "reader",
          "position",
          "peek",
          "next",
          "splitAt",
          "at",
          "slice",
        ],
        types: [
          "Option",
          "Error",
          "Reader",
        ],
      },
      {
        alias: "String",
        values: [
          "NonByte",
          "InvalidIndex",
          "StringError",
          "fromNative",
          "compare",
          "concat",
          "concatWith",
          "toNative",
          "size",
          "str",
          "isPrefix",
          "isSuffix",
          "isSubstring",
          "fields",
          "tokens",
          "extract",
          "substring",
          "map",
          "translate",
        ],
        types: [
          "Error",
          "Slice_error",
        ],
      },
      {
        alias: "Int32",
        values: [
          "InvalidInteger",
          "Overflow",
          "StringError",
          "digits",
          "signed",
          "fromString",
          "complete",
          "parseDecimal",
          "parseNatural",
        ],
        types: [
          "Error",
        ],
      },
      {
        alias: "Int32",
        values: [
          "div",
          "mod",
          "checkedAdd",
          "checkedSub",
          "checkedMul",
          "toReal64",
          "fromReal64",
          "toString",
          "minimum",
          "maximum",
          "InvalidInteger",
          "Overflow",
          "StringError",
          "digits",
          "signed",
          "fromString",
          "complete",
          "parseDecimal",
          "parseNatural",
        ],
        types: [
          "Int",
          "Error",
          "Self",
        ],
      },
      {
        alias: "Int64",
        values: [
          "fromReal64",
          "toReal64",
          "fromString",
          "toString",
        ],
        types: [
          "Int",
          "Self",
        ],
      },
      {
        alias: "JsonValue",
        values: [
          "Null",
          "Boolean",
          "Number",
          "Text",
          "Array",
          "Object",
          "Error",
          "error",
          "Key",
          "Index",
          "Node",
          "node",
          "Malformed",
          "Missing",
          "Mismatch",
        ],
        types: [
          "Value",
          "Error",
          "Step",
          "Node",
          "Problem",
        ],
      },
      {
        alias: "Unicode",
        values: [
          "InvalidScalar",
          "InvalidByte",
          "InvalidLeadingByte",
          "InvalidContinuation",
          "Truncated",
          "Overlong",
          "Surrogate",
          "OutOfRange",
          "OddLength",
          "UnpairedSurrogate",
          "Error",
          "split",
          "isScalar",
          "scalarError",
          "encodeCodes",
        ],
        types: [
          "Reason",
          "Error",
        ],
      },
      {
        alias: "Utf8",
        values: [
          "encodeOne",
          "encode",
          "decodeOne",
          "decode",
        ],
        types: [],
      },
      {
        alias: "JsonParser",
        values: [
          "Cursor",
          "cursor",
          "fail",
          "advance",
          "peek",
          "skip",
          "expect",
          "native",
          "via",
          "take",
          "hex",
          "hex4",
          "text",
          "number",
          "literal",
          "value",
          "decodeWithLimit",
          "decode",
        ],
        types: [
          "Cursor",
        ],
      },
      {
        alias: "Text",
        values: [
          "of",
          "InvalidIndex",
          "UnicodeError",
          "toUtf8",
          "fromUtf8",
          "explode",
          "implode",
          "str",
          "size",
          "extract",
          "substring",
          "map",
          "translate",
          "trim",
          "compare",
          "isPrefix",
          "isSuffix",
          "isSubstring",
          "fields",
          "tokens",
        ],
        types: [
          "Slice_error",
        ],
      },
      {
        alias: "Natural",
        values: [
          "InvalidNatural",
          "InvalidDivisor",
          "isValid",
          "split",
          "divide",
          "toString",
        ],
        types: [
          "Error",
        ],
      },
      {
        alias: "Json",
        values: [
          "assert",
          "unicodeError",
          "decodeBytes",
          "decodeWithLimit",
          "decode",
          "root",
          "read",
          "readBytes",
          "hexDigit",
          "quote",
          "render",
          "encodeBytes",
          "encode",
          "mismatch",
          "get",
          "at",
          "index",
          "nodes",
          "items",
          "entries",
          "fields",
          "keys",
          "text",
          "number",
          "integer",
          "boolean",
          "isNull",
          "value",
          "optional",
          "pathText",
          "problemText",
        ],
        types: [
          "Value",
          "Node",
          "Error",
          "Problem",
        ],
      },
      {
        alias: "List",
        values: [
          "Nil",
          "Cons",
          "None",
          "Some",
          "EmptyList",
          "InvalidCount",
          "InvalidIndex",
          "OutOfBounds",
          "isEmpty",
          "reverseAppend",
          "reverse",
          "append",
          "foldLeft",
          "foldRight",
          "concat",
          "forEach",
          "map",
          "filterMap",
          "filter",
          "partition",
          "find",
          "exists",
          "all",
          "length",
          "dropWhile",
          "validCount",
          "repeat",
          "splitAt",
          "at",
          "take",
          "drop",
          "tabulate",
          "head",
          "tail",
          "last",
          "traverse",
          "collectWith",
          "joinRaw",
          "toString",
          "toStringRender",
          "getItem",
          "findMap",
          "collate",
        ],
        types: [
          "Option",
          "Error",
        ],
      },
      {
        alias: "ListPair",
        values: [
          "UnequalLengths",
          "zip",
          "unzip",
          "map",
          "LengthMismatch",
          "CallbackError",
          "traverse",
        ],
        types: [
          "Error",
          "TraversalError",
        ],
      },
      {
        alias: "ListPair",
        values: [
          "UnequalLengths",
          "zip",
          "unzip",
          "map",
          "LengthMismatch",
          "CallbackError",
          "traverse",
          "forEach",
          "foldLeft",
          "foldRight",
          "all",
          "exists",
        ],
        types: [
          "Error",
          "TraversalError",
        ],
      },
      {
        alias: "Map",
        values: [
          "MapEmpty",
          "MapNode",
          "MapValue",
          "numberCompare",
          "height",
          "max",
          "node",
          "rotateLeft",
          "rotateRight",
          "balance",
          "empty",
          "getTree",
          "get",
          "has",
          "setTree",
          "set",
          "singleton",
          "removeSmallest",
          "removeTree",
          "remove",
          "update",
          "foldTree",
          "fold",
          "toListTree",
          "toList",
          "debugHeight",
          "fromListItems",
          "fromList",
        ],
        types: [
          "MapTree",
          "Map",
        ],
      },
      {
        alias: "Math",
        values: [
          "pi",
          "e",
          "sqrt",
          "sin",
          "cos",
          "tan",
          "asin",
          "acos",
          "atan",
          "atan2",
          "exp",
          "pow",
          "ln",
          "log10",
          "sinh",
          "cosh",
          "tanh",
        ],
        types: [],
      },
      {
        alias: "Monad",
        values: [
          "Carrier",
          "Applicative",
          "via",
          "viaError",
          "map",
          "mapErr",
        ],
        types: [
          "Carrier",
          "Applicative",
        ],
      },
      {
        alias: "Option",
        values: [
          "None",
          "Some",
          "getOr",
          "isSome",
          "map",
          "andThen",
          "filter",
          "toResult",
        ],
        types: [
          "Option",
        ],
      },
      {
        alias: "Option",
        values: [
          "None",
          "Some",
          "getOr",
          "isSome",
          "map",
          "andThen",
          "filter",
          "toResult",
          "map2",
          "traverse",
          "collectList",
          "join",
          "forEach",
          "compose",
          "composePartial",
        ],
        types: [
          "Option",
        ],
      },
      {
        alias: "Real64",
        values: [
          "ManExp",
          "Split",
          "radix",
          "precision",
          "maxFinite",
          "minPos",
          "minNormalPos",
          "posInf",
          "negInf",
          "rem",
          "abs",
          "isNan",
          "isFinite",
          "isNormal",
          "min",
          "max",
          "sign",
          "signBit",
          "sameSign",
          "copySign",
          "compare",
          "unordered",
          "toManExp",
          "fromManExp",
          "split",
          "realMod",
          "nextAfter",
          "checkFloat",
          "realFloor",
          "realCeil",
          "realTrunc",
          "realRound",
          "floor",
          "ceil",
          "trunc",
          "round",
        ],
        types: [
          "Real",
          "Self",
          "ManExp",
          "Split",
        ],
      },
      {
        alias: "Result",
        values: [
          "Ok",
          "Err",
          "None",
          "Some",
          "map",
          "mapErr",
          "andThen",
          "via",
          "viaError",
          "getOr",
          "isOk",
          "toOption",
          "succeed",
          "toBool",
          "map2",
          "carrier",
          "debug",
          "map3",
          "map4",
          "traverse",
          "all",
          "collectList",
          "filter",
        ],
        types: [
          "Option",
          "Result",
        ],
      },
      {
        alias: "String",
        values: [
          "NonByte",
          "InvalidIndex",
          "StringError",
          "fromNative",
          "compare",
          "concat",
          "concatWith",
          "toNative",
          "size",
          "str",
          "isPrefix",
          "isSuffix",
          "isSubstring",
          "fields",
          "tokens",
          "extract",
          "substring",
          "map",
          "translate",
          "toList",
          "isSubsequence",
        ],
        types: [
          "Error",
          "Slice_error",
        ],
      },
      {
        alias: "Task",
        values: [
          "fromResult",
          "succeed",
          "fail",
          "map",
          "map2",
          "race",
          "andThen",
          "mapErr",
          "recover",
          "orElse",
          "all",
          "new",
          "via",
          "viaError",
          "carrier",
          "fromCallback",
          "collectList",
          "traverse",
        ],
        types: [],
      },
      {
        alias: "Traverse",
        values: [
          "with",
        ],
        types: [],
      },
      {
        alias: "Vector",
        values: [
          "maxLen",
          "fromList",
          "tabulate",
          "length",
          "sub",
          "update",
          "concat",
          "appi",
          "app",
          "mapi",
          "map",
          "foldli",
          "foldri",
          "foldl",
          "foldr",
          "findi",
          "find",
          "exists",
          "all",
          "collate",
        ],
        types: [
          "Vector",
        ],
      },
      {
        alias: "VectorSlice",
        values: [
          "length",
          "sub",
          "full",
          "slice",
          "subslice",
          "base",
          "vector",
          "concat",
          "isEmpty",
          "getItem",
          "foldli",
          "foldri",
          "foldl",
          "foldr",
          "appi",
          "app",
          "mapi",
          "map",
          "findi",
          "find",
          "exists",
          "all",
          "collate",
        ],
        types: [
          "Slice",
        ],
      },
      {
        alias: "Word16",
        values: [
          "wordSize",
          "fromReal64",
          "toReal64",
          "andb",
          "orb",
          "xorb",
          "notb",
          "shiftLeft",
          "shiftRight",
          "shiftRightArithmetic",
          "add",
          "sub",
          "mul",
          "div",
          "mod",
        ],
        types: [
          "Word",
          "Self",
        ],
      },
      {
        alias: "Word32",
        values: [
          "wordSize",
          "fromReal64",
          "toReal64",
          "andb",
          "orb",
          "xorb",
          "notb",
          "shiftLeft",
          "shiftRight",
          "shiftRightArithmetic",
          "add",
          "sub",
          "mul",
          "div",
          "mod",
        ],
        types: [
          "Word",
          "Self",
        ],
      },
      {
        alias: "Word64",
        values: [
          "wordSize",
          "fromReal64",
          "toReal64",
          "andb",
          "orb",
          "xorb",
          "notb",
          "shiftLeft",
          "shiftRight",
          "shiftRightArithmetic",
          "add",
          "sub",
          "mul",
          "div",
          "mod",
        ],
        types: [
          "Word",
          "Self",
        ],
      },
      {
        alias: "Word8Vector",
        values: [
          "empty",
          "fromList",
          "toList",
          "length",
          "sub",
          "update",
          "concat",
          "tabulate",
          "mapi",
          "unfoldN",
        ],
        types: [
          "Vector",
        ],
      },
      {
        alias: "Io",
        values: [
          "HostError",
          "NonByte",
          "InvalidPath",
          "bytes",
          "native",
          "host",
          "path",
          "readFile",
          "canonicalPath",
          "writeFile",
          "writeStdout",
          "writeStderr",
          "errorText",
        ],
        types: [
          "Error",
        ],
      },
      {
        alias: "Process",
        values: [
          "Status",
          "success",
          "failure",
          "isSuccess",
          "arguments",
          "system",
          "getEnv",
          "exit",
          "terminate",
          "panic",
        ],
        types: [
          "Status",
        ],
      },
      {
        alias: "Path",
        values: [
          "dir",
        ],
        types: [],
      },
      {
        alias: "OS",
        values: [],
        types: [],
      },
      {
        alias: "SmlEscape",
        values: [
          "None",
          "Some",
          "NonByte",
          "spellings",
          "escapeByte",
          "escapeBytes",
          "escapeString",
        ],
        types: [
          "Option",
          "Error",
        ],
      },
      {
        alias: "Source",
        values: [
          "Empty",
          "Byte",
          "Branch",
          "length",
          "join",
          "build",
          "fromBytes",
          "fromNative",
          "at",
          "boundary",
          "slice",
        ],
        types: [
          "Source",
        ],
      },
      {
        alias: "StringCvt",
        values: [
          "repeat",
          "pad",
          "padLeft",
          "padRight",
          "padTextLeft",
          "padTextRight",
        ],
        types: [],
      },
      {
        alias: "Utf16",
        values: [
          "LittleEndian",
          "BigEndian",
          "unitCodes",
          "encodeOne",
          "encode",
          "readUnit",
          "decodeOne",
          "decode",
        ],
        types: [
          "Endian",
        ],
      },
      {
        alias: "Utf16Source",
        values: [
          "None",
          "Some",
          "InvalidUnit",
          "InvalidIndex",
          "UnicodeError",
          "Empty",
          "Unit",
          "Branch",
          "Source",
          "treeLength",
          "length",
          "isUnit",
          "fromUnits",
          "fromNativeUnits",
          "peek",
          "at",
          "slice",
          "toUnits",
          "fromUtf16Bytes",
          "toUtf16Bytes",
          "fromScalars",
          "toScalars",
          "fromUtf8",
          "toUtf8",
        ],
        types: [
          "Option",
          "Error",
          "Tree",
          "Source",
        ],
      },
      {
        alias: "WonValue",
        values: [
          "Null",
          "Boolean",
          "Number",
          "Text",
          "Blob",
          "List",
          "Record",
          "Tag",
          "Error",
          "makeError",
          "Node",
          "makeNode",
          "Malformed",
          "Missing",
          "Mismatch",
        ],
        types: [
          "Value",
          "Error",
          "Node",
          "Problem",
        ],
      },
      {
        alias: "WonSyntax",
        values: [
          "None",
          "Some",
          "native",
          "bytes",
          "digit",
          "firstName",
          "nameChar",
          "identifier",
          "hexDigits",
          "hex",
          "hexPair",
          "hexByte",
          "quote",
          "textValid",
          "keyText",
          "duplicate",
        ],
        types: [
          "Option",
        ],
      },
      {
        alias: "WonParser",
        values: [
          "None",
          "Some",
          "Cursor",
          "makeCursor",
          "via",
          "fail",
          "advance",
          "peek",
          "space",
          "take",
          "block",
          "skip",
          "expect",
          "text",
          "name",
          "number",
          "key",
          "blob",
          "collect",
          "value",
          "decode",
        ],
        types: [
          "Option",
          "Cursor",
        ],
      },
      {
        alias: "Won",
        values: [
          "None",
          "Some",
          "decode",
          "render",
          "encode",
          "pathText",
          "keyStep",
          "mismatch",
          "lookup",
          "root",
          "read",
          "get",
          "attribute",
          "indexStep",
          "index",
          "payload",
          "tagName",
          "items",
          "entries",
          "text",
          "textString",
          "number",
          "boolean",
          "blob",
          "value",
          "optional",
          "problemText",
        ],
        types: [
          "Option",
          "Value",
          "Error",
          "Node",
          "Problem",
        ],
      },
    ],
  );
});

/**
 * `B303`/`G9`: the dynamic profile is built from the same description as the static one.
 *
 * Every runtime name the manifest declares must actually be defined by the emitted
 * prelude. Without this, a manifest edit could leave the static basis advertising an
 * implementation that no longer exists, which is exactly the static/runtime prelude
 * drift recorded as audit finding `B5`.
 */
Deno.test("[module update B303/G9] emitted runtime defines every manifest runtime name", async () => {
  const compiled = await compile("let main = () => { print(1) };");

  const cataloguedOperators = [...BASIS_OPERATORS, ...BASIS_UNARY_OPERATORS]
    .flatMap((operator) => [
      { spelling: operator.spelling, runtimeName: operator.runtimeName },
      ...(operator.directRuntimeName
        ? [{ spelling: operator.spelling, runtimeName: operator.directRuntimeName }]
        : []),
    ]);
  const missingOperators = cataloguedOperators
    .filter((operator) => !compiled.includes(`const ${operator.runtimeName} =`))
    .map((operator) => `${operator.spelling} -> ${operator.runtimeName}`);
  assertEquals(missingOperators, []);

  const missingConstructors = BASIS_TYPES
    .flatMap((type) => type.constructors ?? [])
    .filter((constructor) => !compiled.includes(`const ${constructor.runtimeName} =`))
    .map((constructor) => `${constructor.name} -> ${constructor.runtimeName}`);
  assertEquals(missingConstructors, []);

  // The converse: every emitted operator definition traces back to a catalog entry, so no
  // hand-written definition can survive alongside the manifest-derived ones.
  const emittedOperators = [...compiled.matchAll(/const (__wm_op_[A-Za-z0-9_]+) =/g)]
    .map((match) => match[1]);
  const declared = new Set(cataloguedOperators.map((operator) => operator.runtimeName));
  assertEquals(emittedOperators.filter((name) => !declared.has(name)), []);
});

/**
 * The constructor runtime name is a single manifest fact rather than a formula that
 * lowering recomputes from the constructor's spelling.
 */
Deno.test("[module update B302] constructor runtime names come from the manifest", () => {
  for (const type of BASIS_TYPES) {
    for (const constructor of type.constructors ?? []) {
      assertEquals(basisCtorJsName(constructor.id), constructor.runtimeName);
    }
  }
});

/**
 * `B303`/`G9` for host values: every statically visible basis value, intrinsic with a
 * runtime name, and constructor must evaluate to a defined runtime value, including
 * qualified members such as `Js.Array.toList` and `Text.of`.
 *
 * `T131` above proves the references compile and the program loads; this test proves
 * each reference is actually *defined*, because a missing member of an existing
 * namespace object evaluates to `undefined` without throwing.
 */
Deno.test("[module update B303/G9] every basis fact evaluates to a defined runtime value", async () => {
  const artifact = initialBasis(BASIS_PROFILES.default);
  const references = [
    ...artifact.facts.values.map((value) => value.exportName),
    ...artifact.facts.intrinsics.flatMap((intrinsic) =>
      intrinsic.runtimeName ? [intrinsic.exportName] : []
    ),
    ...artifact.facts.constructors.map((constructor) =>
      constructor.name.includes(".")
        ? constructor.name
        : `${constructor.typeName}.${constructor.name}`
    ),
  ];

  const source = references
    .map((reference, index) => `let probe${index} = ${reference};`)
    .join(" ");
  const compiled = await compileLibraryVirtual(
    "/test/probe.wm",
    new Map([["/test/probe.wm", source]]),
  );
  const module = await importProgram(
    `data:text/javascript;base64,${btoa(compiled)}#${crypto.randomUUID()}`,
  ) as Record<string, unknown>;

  const undefinedReferences = references
    .filter((_, index) => module[`probe${index}`] === undefined)
    .sort();
  assertEquals(undefinedReferences, []);
});
