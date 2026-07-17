import {
  WMSLANG_BUILTIN_BLOCKERS as PREVIOUS_BLOCKERS,
  WMSLANG_BUILTIN_OVERLOADS as PREVIOUS_OVERLOADS,
} from "../src/wmslang/builtin_catalog.generated.ts";

const ROOT = new URL("../", import.meta.url);
const SOURCE = new URL("research/slang/docs/stdlib-doc.md", ROOT);
const OUTPUT = new URL("src/wmslang/builtin_catalog.generated.ts", ROOT);

const CATALOG_SCHEMA_VERSION = 3;
const valueTypes = [
  "f32",
  "f32x2",
  "f32x3",
  "f32x4",
  "i32",
  "i32x2",
  "i32x3",
  "i32x4",
] as const;
type ValueType = (typeof valueTypes)[number];
type NumericRepresentation = "f32" | "i32";

type Candidate = {
  name: string;
  params: ValueType[];
  result: ValueType;
  sourceSignature: string;
};

type BlockerCategory =
  | "representation"
  | "parameter-mode"
  | "effect"
  | "stage"
  | "target-capability";

type Blocker = {
  name: string;
  categories: BlockerCategory[];
  sourceSignatures: string[];
  evidence: string[];
};

const source = await Deno.readTextFile(SOURCE);
const sourceSha256 = await sha256(new TextEncoder().encode(source));
const extracted = extractCatalog(source);
const backend = await loadDefaultWmslangSlangBackend();
const verification = verifyCandidates(v5Candidates(extracted.candidates), backend);
const blockers = mergeBlockers(
  extracted.blockers,
  [...PREVIOUS_BLOCKERS],
  verification.blockers,
);
const generated = renderCatalog(verification.verified, blockers, sourceSha256);

if (Deno.args.includes("--check")) {
  const checkedIn = await Deno.readTextFile(OUTPUT);
  if (checkedIn !== generated) {
    throw new Error(
      "checked-in wmslang builtin catalog is stale; run deno task wmslang:builtins",
    );
  }
  console.log(
    `verified deterministic catalog with ${verification.verified.length} fragment/WGSL Slang builtin overloads`,
  );
} else {
  await Deno.writeTextFile(OUTPUT, generated);
  console.log(`generated ${verification.verified.length} fragment/WGSL Slang builtin overloads`);
}

function v5Candidates(candidates: Candidate[]): Candidate[] {
  const previousFloatRows = new Set(
    PREVIOUS_OVERLOADS.filter((overload) =>
      [...overload.params, overload.result].every((type) => type.startsWith("f32"))
    ).map(candidateKey),
  );
  const previousBlockers = new Map(PREVIOUS_BLOCKERS.map((item) => [item.name, item]));
  return candidates.filter((candidate) => {
    const types = [...candidate.params, candidate.result];
    if (types.every((type) => type.startsWith("f32"))) {
      return previousFloatRows.has(candidateKey(candidate));
    }
    if (!types.every((type) => type.startsWith("i32"))) return false;
    const floatShape = {
      ...candidate,
      params: candidate.params.map(floatShapeType),
      result: floatShapeType(candidate.result),
    };
    if (previousFloatRows.has(candidateKey(floatShape))) return true;
    const blocker = previousBlockers.get(candidate.name);
    return blocker !== undefined &&
      !blocker.categories.includes("stage") &&
      !blocker.categories.includes("target-capability");
  });
}

function candidateKey(candidate: Pick<Candidate, "name" | "params" | "result">): string {
  return `${candidate.name}(${candidate.params.join(",")})->${candidate.result}`;
}

function floatShapeType(type: ValueType): ValueType {
  return (type.startsWith("i32") ? type.replace("i32", "f32") : type) as ValueType;
}

function extractCatalog(markdown: string): { candidates: Candidate[]; blockers: Blocker[] } {
  const headings = [...markdown.matchAll(/^# `([^`]+)`$/gm)];
  const candidates: Candidate[] = [];
  const blockers: Blocker[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const name = headings[index][1];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const start = headings[index].index! + headings[index][0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const signatureBlock = section.match(/## Signature\s+```(?:\w+)?\s*([\s\S]*?)```/);
    if (!signatureBlock) continue;
    const declarations = signatureBlock[1]
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("///"))
      .join("\n")
      .split(";")
      .map((declaration) => declaration.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (const declaration of declarations) {
      const expanded = expandDeclaration(name, declaration);
      candidates.push(...expanded.candidates);
      if (expanded.blocker) blockers.push(expanded.blocker);
    }
  }
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.name}(${candidate.params.join(",")})->${candidate.result}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return {
    candidates: [...unique.values()].sort((left, right) =>
      left.name.localeCompare(right.name) ||
      left.params.length - right.params.length ||
      left.params.join(",").localeCompare(right.params.join(",")) ||
      left.result.localeCompare(right.result)
    ),
    blockers: mergeBlockers(blockers),
  };
}

function expandDeclaration(
  name: string,
  declaration: string,
): { candidates: Candidate[]; blocker?: Blocker } {
  const signature = `${declaration};`;
  const match = declaration.match(
    /^(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^()]*>)?\((.*)\)$/,
  );
  if (!match || match[2] !== name) {
    return { candidates: [], blocker: blocker(name, "representation", signature) };
  }
  const resultSource = match[1].trim();
  if (/\b(out|inout|ref)\b/.test(match[3])) {
    return { candidates: [], blocker: blocker(name, "parameter-mode", signature) };
  }
  if (resultSource === "void") {
    return { candidates: [], blocker: blocker(name, "effect", signature) };
  }
  const parameterSources = splitTopLevel(match[3]).map(parameterType);
  if (parameterSources.some((type) => type === undefined)) {
    return { candidates: [], blocker: blocker(name, "representation", signature) };
  }
  const widths = referencedGenericWidth([resultSource, ...parameterSources as string[]])
    ? [2, 3, 4]
    : [0];
  const representations: NumericRepresentation[] = [
      resultSource,
      ...parameterSources as string[],
    ].some(referencesGenericScalar)
    ? ["f32", "i32"]
    : ["f32"];
  const candidates = widths.flatMap((width) =>
    representations.flatMap((representation) => {
      const result = concreteType(resultSource, width, representation);
      const params = (parameterSources as string[]).map((type) =>
        concreteType(type, width, representation)
      );
      if (!result || params.some((type) => !type)) return [];
      return [{
        name,
        params: params as ValueType[],
        result,
        sourceSignature: signature,
      }];
    })
  );
  return candidates.length > 0
    ? { candidates }
    : { candidates: [], blocker: blocker(name, "representation", signature) };
}

function splitTopLevel(value: string): string[] {
  if (value.trim() === "") return [];
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<" || char === "(") depth += 1;
    if (char === ">" || char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function parameterType(parameter: string): string | undefined {
  if (parameter === "") return undefined;
  const normalized = parameter.replace(/^in\s+/, "").trim();
  if (/\b(constexpr|out|inout|ref)\b/.test(normalized)) return undefined;
  const match = normalized.match(/^(.+?)\s+[A-Za-z_][A-Za-z0-9_]*$/);
  return match?.[1].trim();
}

function referencedGenericWidth(types: string[]): boolean {
  return types.some((type) => /^vector<(?:T|float),\s*N>$/.test(type));
}

function referencesGenericScalar(source: string): boolean {
  return /(?:^|[<,])\s*T\s*(?:$|[>,])/.test(source);
}

function concreteType(
  source: string,
  genericWidth: number,
  representation: NumericRepresentation,
): ValueType | undefined {
  const type = source.replace(/\s+/g, "");
  if (type === "T") return representation;
  if (type === "float") return "f32";
  if (type === "int") return "i32";
  const vector = type.match(/^vector<(T|float|int),(N|[234])>$/);
  if (!vector) return undefined;
  const width = vector[2] === "N" ? genericWidth : Number(vector[2]);
  if (width < 2 || width > 4) return undefined;
  const component = vector[1] === "T" ? representation : vector[1] === "int" ? "i32" : "f32";
  return `${component}x${width}` as ValueType;
}

function renderCatalog(candidates: Candidate[], blockers: Blocker[], sourceSha256: string): string {
  const rows = candidates.map((candidate, id) => ({ id, ...candidate }));
  return `// Generated by scripts/generate_wmslang_builtin_catalog.ts. Do not edit.\n` +
    `// Source: research/slang/docs/stdlib-doc.md\n\n` +
    `export const WMSLANG_BUILTIN_CATALOG_SCHEMA_VERSION = ${CATALOG_SCHEMA_VERSION} as const;\n` +
    `export const WMSLANG_BUILTIN_CATALOG_IDENTITY = ${
      JSON.stringify(
        {
          slangVersion: WMSLANG_SLANG_VERSION,
          sourceSha256,
        },
        null,
        2,
      )
    } as const;\n\n` +
    `export type WmslangBuiltinValueType = ${
      valueTypes.map((type) => JSON.stringify(type)).join(" | ")
    };\n\n` +
    `export type WmslangBuiltinOverload = {\n` +
    `  id: number;\n` +
    `  name: string;\n` +
    `  params: WmslangBuiltinValueType[];\n` +
    `  result: WmslangBuiltinValueType;\n` +
    `  sourceSignature: string;\n` +
    `};\n\n` +
    `export const WMSLANG_BUILTIN_OVERLOADS: readonly WmslangBuiltinOverload[] = ` +
    `${JSON.stringify(rows, null, 2)};\n\n` +
    `export type WmslangBuiltinBlockerCategory = ` +
    `"representation" | "parameter-mode" | "effect" | "stage" | "target-capability";\n\n` +
    `export type WmslangBuiltinBlocker = {\n` +
    `  name: string;\n` +
    `  categories: WmslangBuiltinBlockerCategory[];\n` +
    `  sourceSignatures: string[];\n` +
    `  evidence: string[];\n` +
    `};\n\n` +
    `export const WMSLANG_BUILTIN_BLOCKERS: readonly WmslangBuiltinBlocker[] = ` +
    `${JSON.stringify(blockers, null, 2)};\n`;
}

function probeSource(candidate: Candidate): string {
  const args = candidate.params.map((type, index) => probeValue(type, index)).join(", ");
  const result = `wm_builtin_result`;
  return `// Generated wmslang builtin capability probe.\n\n` +
    `float4 wm_builtin_probe(float2 coord) {\n` +
    `  ${slangType(candidate.result)} ${result} = ${candidate.name}(${args});\n` +
    `  return ${probeColor(candidate.result, result)};\n` +
    `}\n\n` +
    `[shader("vertex")]\n` +
    `float4 wm_vertex(uint vertexID : SV_VertexID) : SV_Position {\n` +
    `  float2 uv = float2((vertexID << 1) & 2, vertexID & 2);\n` +
    `  return float4(uv * 2.0 - 1.0, 0.0, 1.0);\n` +
    `}\n\n` +
    `[shader("fragment")]\n` +
    `float4 wm_fragment(float4 position : SV_Position) : SV_Target {\n` +
    `  return wm_builtin_probe(float2(position.x, position.y));\n` +
    `}\n`;
}

function verifyCandidates(
  candidates: Candidate[],
  backend: Awaited<ReturnType<typeof loadDefaultWmslangSlangBackend>>,
): { verified: Candidate[]; blockers: Blocker[] } {
  let remaining = candidates;
  const blockers: Blocker[] = [];
  for (let pass = 1; pass <= 32; pass += 1) {
    const { source, lineOwners } = batchProbeSource(remaining);
    try {
      backend.compile(source);
      return { verified: remaining, blockers: mergeBlockers(blockers) };
    } catch (error) {
      if (!(error instanceof WmslangBackendError)) throw error;
      const rejected = new Set<number>();
      for (
        const match of error.backendDiagnostic.matchAll(
          /error\[[^\]]+\]:[\s\S]*?--> \/wmslang-v1\.slang:(\d+):/g,
        )
      ) {
        const owner = lineOwners.get(Number(match[1]));
        if (owner !== undefined) rejected.add(owner);
      }
      for (
        const match of error.backendDiagnostic.matchAll(
          /(?:warning\[[^\]]+\]:|note: see using)[\s\S]*?--> \/wmslang-v1\.slang:(\d+):/g,
        )
      ) {
        const owner = lineOwners.get(Number(match[1]));
        if (owner !== undefined) rejected.add(owner);
      }
      if (rejected.size === 0) {
        throw new Error(`cannot map Slang builtin probe diagnostics:\n${error.backendDiagnostic}`);
      }
      const rejectedFamilies = new Set<string>();
      const rejectedNames = new Set<string>();
      for (const index of rejected) {
        const candidate = remaining[index];
        const diagnostic = diagnosticForCandidate(error.backendDiagnostic, lineOwners, index);
        if (Deno.env.get("WMSLANG_BUILTIN_DEBUG") === candidate.name) {
          console.log(`diagnostic for ${candidate.name}:\n${diagnostic}`);
        }
        const categories = classifyBackendBlockers(diagnostic);
        for (const category of categories) {
          blockers.push(blocker(candidate.name, category, candidate.sourceSignature, diagnostic));
        }
        if (categories.includes("stage") || categories.includes("target-capability")) {
          rejectedNames.add(candidate.name);
        } else {
          rejectedFamilies.add(candidateFamily(candidate));
        }
      }
      const rejectedRows = [...rejected].map((index) => remaining[index]);
      console.log(
        `Slang rejected ${
          rejectedRows.map((candidate) => `${candidate.name}(${candidate.params.join(",")})`).join(
            ", ",
          )
        } in probe pass ${pass}`,
      );
      remaining = remaining.filter((candidate) =>
        !rejectedNames.has(candidate.name) && !rejectedFamilies.has(candidateFamily(candidate))
      );
    }
  }
  throw new Error("Slang builtin capability probes did not converge after 32 passes");
}

function candidateFamily(candidate: Candidate): string {
  const representations = [...candidate.params, candidate.result].map((type) =>
    type.startsWith("i32") ? "i32" : "f32"
  );
  return `${candidate.name}:${representations.join(",")}`;
}

function blocker(
  name: string,
  category: BlockerCategory,
  sourceSignature: string,
  evidence?: string,
): Blocker {
  return {
    name,
    categories: [category],
    sourceSignatures: [sourceSignature],
    evidence: evidence ? [compactEvidence(evidence)] : [],
  };
}

function mergeBlockers(...groups: Blocker[][]): Blocker[] {
  const merged = new Map<string, Blocker>();
  for (const item of groups.flat()) {
    const current = merged.get(item.name) ?? {
      name: item.name,
      categories: [],
      sourceSignatures: [],
      evidence: [],
    };
    current.categories = uniqueSorted([...current.categories, ...item.categories]);
    current.sourceSignatures = uniqueSorted([
      ...current.sourceSignatures,
      ...item.sourceSignatures,
    ]);
    current.evidence = uniqueSorted([...current.evidence, ...item.evidence]);
    merged.set(item.name, current);
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueSorted<T extends string>(items: T[]): T[] {
  return [...new Set(items)].sort() as T[];
}

function diagnosticForCandidate(
  diagnostic: string,
  lineOwners: Map<number, number>,
  candidateIndex: number,
): string {
  const chunks = diagnostic.split(/\n(?=(?:error|warning)\[[^\]]+\]:|note:)/g);
  const ownedIndexes = chunks.flatMap((chunk, index) => {
    for (const match of chunk.matchAll(/\/wmslang-v1\.slang:(\d+):/g)) {
      if (lineOwners.get(Number(match[1])) === candidateIndex) return [index];
    }
    return [];
  });
  const selected = new Set<number>();
  for (const index of ownedIndexes) {
    selected.add(index);
    if (chunks[index].startsWith("note:") && index > 0) selected.add(index - 1);
  }
  return [...selected].sort((left, right) => left - right).map((index) => chunks[index]).join(
    "\n",
  ) ||
    diagnostic;
}

function classifyBackendBlockers(diagnostic: string): BlockerCategory[] {
  const categories: BlockerCategory[] = [];
  if (
    /shader stage|(?:not|only) available in[^\n]*stage|ray (generation|tracing)|intersection shader|closest.hit|any.hit|miss shader/i
      .test(diagnostic)
  ) categories.push("stage");
  if (/WGSL|compilation target|capabilit|not supported|unimplemented|SPIR-V/i.test(diagnostic)) {
    categories.push("target-capability");
  }
  return categories.length > 0 ? categories : ["representation"];
}

function compactEvidence(diagnostic: string): string {
  return diagnostic
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("-->"))
    .slice(0, 3)
    .join(" ")
    .slice(0, 500);
}

function batchProbeSource(candidates: Candidate[]): {
  source: string;
  lineOwners: Map<number, number>;
} {
  const lines = ["// Generated wmslang builtin capability probes.", ""];
  const lineOwners = new Map<number, number>();
  candidates.forEach((candidate, index) => {
    const helper = probeSource(candidate).split("\n").slice(2, 6);
    helper[0] = helper[0].replace("wm_builtin_probe", `wm_builtin_probe_${index}`);
    for (const line of helper) {
      lines.push(line);
      lineOwners.set(lines.length, index);
    }
    lines.push("");
  });
  lines.push(
    '[shader("vertex")]',
    "float4 wm_vertex(uint vertexID : SV_VertexID) : SV_Position {",
    "  float2 uv = float2((vertexID << 1) & 2, vertexID & 2);",
    "  return float4(uv * 2.0 - 1.0, 0.0, 1.0);",
    "}",
    "",
    '[shader("fragment")]',
    "float4 wm_fragment(float4 position : SV_Position) : SV_Target {",
  );
  lines.push("  float4 color = float4(0.0, 0.0, 0.0, 1.0);");
  candidates.forEach((_candidate, index) => {
    lines.push(`  color += wm_builtin_probe_${index}(position.xy) * 0.000001;`);
    lineOwners.set(lines.length, index);
  });
  lines.push("  return color;", "}", "");
  return { source: lines.join("\n"), lineOwners };
}

function slangType(type: ValueType): string {
  if (type === "f32") return "float";
  if (type === "i32") return "int";
  return `${type.startsWith("i32") ? "int" : "float"}${type.at(-1)}`;
}

function probeValue(type: ValueType, index: number): string {
  const offset = (index + 1) * 0.125;
  if (type === "f32") return `(coord.x + ${offset})`;
  if (type === "i32") return `int(coord.x + ${offset})`;
  if (type === "f32x2") return `float2(coord.x + ${offset}, coord.y + ${offset})`;
  if (type === "f32x3") return `float3(coord.x + ${offset}, coord.y + ${offset}, ${offset})`;
  if (type === "f32x4") {
    return `float4(coord.x + ${offset}, coord.y + ${offset}, ${offset}, ${offset + 0.25})`;
  }
  const width = Number(type.at(-1));
  const values = [
    `int(coord.x + ${offset})`,
    `int(coord.y + ${offset})`,
    `${index + 1}`,
    `${index + 2}`,
  ].slice(0, width);
  return `int${width}(${values.join(", ")})`;
}

function probeColor(type: ValueType, value: string): string {
  if (type === "f32") return `float4(${value}, ${value}, ${value}, 1.0)`;
  if (type === "f32x2") return `float4(${value}, 0.0, 1.0)`;
  if (type === "f32x3") return `float4(${value}, 1.0)`;
  if (type === "f32x4") return value;
  if (type === "i32") return `float4(float(${value}), float(${value}), float(${value}), 1.0)`;
  const width = Number(type.at(-1));
  if (width === 2) return `float4(float2(${value}), 0.0, 1.0)`;
  if (width === 3) return `float4(float3(${value}), 1.0)`;
  return `float4(${value})`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
import {
  loadDefaultWmslangSlangBackend,
  WMSLANG_SLANG_VERSION,
  WmslangBackendError,
} from "../src/wmslang/slang_backend.ts";
