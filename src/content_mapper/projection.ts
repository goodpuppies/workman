import { functionArguments } from "../core/js_abi.ts";
import { analyzeRecoveredVirtual } from "../compiler.ts";
import { renderDiagnosticSummary } from "../diagnostic_model.ts";
import type { FrontendDiagnostic } from "../diagnostic_model.ts";
import type { ModuleInterface, SemanticCallableDefinition } from "../module_interface.ts";
import type { StaticEnv } from "../infer/environment.ts";
import type { ProjectSnapshot } from "../module_interface.ts";
import { readOverlays } from "./project.ts";
import { prune, type Scheme, type Ty } from "../types.ts";
import type { MapperDiagnostic, SpanMapping, TransformResult } from "./protocol.ts";

class UnsupportedProjection extends Error {}

type ParameterStages = SemanticCallableDefinition["parameterStages"];

// These names cannot bind a value in a strict-mode TS module. Contextual TS words such as
// `type` and `number` remain valid value names and should keep their source spelling.
const reservedBindings = new Set(
  ("await break case catch class const continue debugger default delete do else enum export " +
    "extends false finally for function if import in instanceof new null return super switch " +
    "this throw true try typeof var void while with implements interface let package private " +
    "protected public static yield eval arguments").split(" "),
);

function isBindingName(name: string): boolean {
  return /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(name) &&
    !reservedBindings.has(name);
}

/** Source-derived names for spellings TS cannot bind, with no collisions with real exports. */
function nameAllocator(reserved: Iterable<string> = []): (name: string) => string {
  const used = new Set(reserved);
  return (name) => {
    const base = name.replaceAll("'", "_prime").replace(/[^$_\p{ID_Continue}]/gu, "_");
    const stem = isBindingName(base) ? base : `_${base}`;
    let candidate = stem;
    for (let suffix = 2; used.has(candidate); suffix++) candidate = `${stem}_${suffix}`;
    used.add(candidate);
    return candidate;
  };
}

function sourceParameterNames(names: readonly string[]): string[] {
  const fallback = nameAllocator(names.filter(isBindingName));
  return names.map((name) => isBindingName(name) ? name : fallback(name));
}

/** A tooling-only projection of inferred WM interfaces, independent of runtime emission. */
export async function projectWorkman(
  fileName: string,
  content: string,
  overlays?: Map<string, string>,
): Promise<TransformResult> {
  // Always use the request's content, including an editor's unsaved version. Recovery retains
  // independently valid declarations while reporting errors in the current buffer.
  const sources = new Map(overlays ?? await readOverlays());
  sources.set(fileName, content);
  const snapshot = await analyzeRecoveredVirtual(fileName, sources);
  const document = snapshot.interfaces.get(snapshot.head)!;
  return projectInterface(document, content, snapshot);
}

export function projectInterface(
  document: ModuleInterface,
  source: string,
  snapshot?: ProjectSnapshot,
): TransformResult {
  const output: TransformResult = {
    text: "// Workman semantic projection; not executable output.\nexport {};\n",
    extension: ".ts",
    mappings: [],
    diagnostics: [],
  };
  const unsupported = (name: string, message: string, start = 0, length = 0) => {
    output.diagnostics.push({
      code: 1001,
      messageText: `Cannot project ${JSON.stringify(name)} into TypeScript yet: ${message}`,
      start,
      length,
    });
  };
  // Imported declarations retain their inferred schemes. Reuse source parameter names from
  // their defining interface when available; no parser or alternate module resolver lives here.
  const parameterNames = new Map<Ty, ParameterStages>();
  for (const owner of snapshot?.interfaces.values() ?? [document]) {
    for (const [name, scheme] of owner.publicEnvironment.valEnv) {
      const origin = owner.origins.get(name)?.find((item) => item.kind === "value");
      if (origin?.kind !== "value") continue;
      const callable = owner.callableDefinitions.find((item) => item.target === origin.bindingId);
      if (callable) parameterNames.set(scheme.type, callable.parameterStages);
    }
  }
  const structureType = (environment: StaticEnv, prefix: string): string => {
    const members: string[] = [];
    for (const [name] of environment.tyEnv) {
      unsupported(`${prefix}.${name}`, "exported type declarations are not supported");
    }
    for (const [name, scheme] of environment.valEnv) {
      if (environment.strEnv.has(name)) {
        unsupported(`${prefix}.${name}`, "a value and structure share this export name");
        continue;
      }
      try {
        members.push(
          `readonly ${JSON.stringify(name)}: ${
            projectScheme(scheme, parameterNames.get(scheme.type))
          }`,
        );
      } catch (error) {
        if (!(error instanceof UnsupportedProjection)) throw error;
        unsupported(`${prefix}.${name}`, error.message);
      }
    }
    for (const [name, nested] of environment.strEnv) {
      if (environment.valEnv.has(name)) continue;
      members.push(
        `readonly ${JSON.stringify(name)}: ${structureType(nested, `${prefix}.${name}`)}`,
      );
    }
    return `{ ${members.join("; ")} }`;
  };
  for (const [name] of document.publicEnvironment.tyEnv) {
    unsupported(name, "exported type declarations are not supported");
  }
  const fallbackName = nameAllocator(
    [...document.publicEnvironment.valEnv.keys(), ...document.publicEnvironment.strEnv.keys()]
      .filter(isBindingName),
  );
  const exports = [
    ...[...document.publicEnvironment.valEnv].map(([name, scheme]) => ({
      name,
      scheme,
      structure: undefined as StaticEnv | undefined,
    })),
    ...[...document.publicEnvironment.strEnv].map(([name, structure]) => ({
      name,
      scheme: undefined,
      structure,
    })),
  ];
  const conflicts = new Set(
    [...document.publicEnvironment.strEnv.keys()].filter((name) =>
      document.publicEnvironment.valEnv.has(name)
    ),
  );
  for (const name of conflicts) unsupported(name, "a value and structure share this export name");
  for (const { name, scheme, structure } of exports) {
    if (conflicts.has(name)) continue;
    const origin = document.origins.get(name)?.find((origin) => origin.kind !== "type");
    // Origins belong to this input only: never map a dependency offset into the importer.
    const span = origin?.moduleId === document.moduleId ? origin.span : undefined;
    try {
      const callable = origin?.kind === "value"
        ? document.callableDefinitions.find((definition) => definition.target === origin.bindingId)
        : undefined;
      const type = structure
        ? structureType(structure, name)
        : projectScheme(scheme!, callable?.parameterStages ?? parameterNames.get(scheme!.type));
      const direct = isBindingName(name);
      const localName = direct ? name : fallbackName(name);
      output.text += direct ? "export declare const " : "declare const ";
      const declarationStart = output.text.length;
      output.text += `${localName}: ${type};\n`;
      if (span) {
        // Read-only navigation features; TS-generated edits are not valid WM edits.
        const features = 1 | 2 | 8 | 16 | 64;
        output.mappings.push([
          declarationStart,
          localName.length,
          span.start,
          span.end - span.start,
          source.slice(span.start, span.end) === localName ? 0 : 2,
          features,
        ]);
      }
      if (!direct) {
        output.text += `export { ${localName} as `;
        const exportStart = output.text.length;
        const exportName = JSON.stringify(name);
        output.text += `${exportName} };\n`;
        if (span && source.slice(span.start, span.end) === name) {
          const mapping: SpanMapping = [
            exportStart,
            exportName.length,
            span.start,
            span.end - span.start,
            2,
            1 | 2 | 8 | 16 | 64,
          ];
          output.mappings.push(mapping);
        }
      }
    } catch (error) {
      if (!(error instanceof UnsupportedProjection)) throw error;
      unsupported(name, error.message, span?.start, span ? span.end - span.start : 0);
    }
  }
  output.diagnostics.push(
    ...document.diagnostics.filter((d) => d.severity === "error").map((d) =>
      mapperDiagnostic(d, source.length)
    ),
  );
  return output;
}

/** Translate a generalized HM scheme explicitly; never ask TS to re-infer the WM body. */
function projectScheme(scheme: Scheme, parameterStages?: ParameterStages): string {
  if (scheme.constraints?.length) {
    throw new UnsupportedProjection("constrained polymorphism is not supported");
  }
  const quantified = new Set(scheme.vars);
  const variables = new Map<number, string>();
  const genericName = nameAllocator(["any", "unknown", "never", "number", "string", "boolean"]);
  const render = (input: Ty, stages?: ParameterStages): string => {
    const type = prune(input);
    switch (type.tag) {
      case "var": {
        if (
          !quantified.has(type.id) || type.numeric || type.equalityConstraint ||
          type.projectionFields?.length
        ) {
          throw new UnsupportedProjection("unresolved or constrained type variable");
        }
        let name = variables.get(type.id);
        if (!name) {
          const index = variables.size;
          name = genericName(type.name ?? (index < 7 ? "TUVWXYZ"[index] : `T${index - 6}`));
          variables.set(type.id, name);
        }
        return name;
      }
      case "prim": {
        const primitive: Record<string, string> = {
          Number: "number",
          Bool: "boolean",
          String: "string",
          Void: "undefined",
        };
        const mapped = primitive[type.name];
        if (mapped) return mapped;
        throw new UnsupportedProjection(`primitive type ${type.name}`);
      }
      case "fn": {
        // Shared with library emission: only the outer parameter tuple is detupled.
        const params = functionArguments(type);
        const names = stages?.[0] && sourceParameterNames(stages[0]);
        const parameterName = nameAllocator();
        return `(${
          params.map((p, i) => {
            const argument = prune(p);
            const name = names?.length === params.length ? names[i] : undefined;
            const fallback = argument.tag === "fn"
              ? "callback"
              : argument.tag === "tuple"
              ? "args"
              : "value";
            return `${parameterName(name ?? fallback)}: ${render(p)}`;
          }).join(", ")
        }) => ${render(type.result, stages?.slice(1))}`;
      }
      case "tuple":
        return `[${type.items.map((item) => render(item)).join(", ")}]`;
      case "struct":
        return `{ ${
          type.fields.map((f) => `readonly ${JSON.stringify(f.name)}: ${render(f.type)}`).join("; ")
        } }`;
      case "named":
        throw new UnsupportedProjection(`nominal type ${type.name}`);
      case "ffi":
        throw new UnsupportedProjection("unresolved foreign type");
    }
  };
  const result = render(scheme.type, parameterStages);
  if (variables.size === 0) return result;
  if (prune(scheme.type).tag !== "fn") {
    throw new UnsupportedProjection("polymorphic non-function value");
  }
  const parameters = [...variables.values()];
  return `<${parameters.join(", ")}>${result}`;
}

function mapperDiagnostic(diagnostic: FrontendDiagnostic, sourceLength: number): MapperDiagnostic {
  const span = diagnostic.primary.kind === "source" ? diagnostic.primary.span : undefined;
  const start = Math.max(0, Math.min(span?.start ?? 0, sourceLength));
  return {
    code: 1000,
    messageText: `[${diagnostic.code}] ${renderDiagnosticSummary(diagnostic)}`,
    start,
    length: Math.max(0, Math.min(span?.end ?? start, sourceLength) - start),
  };
}
