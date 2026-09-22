// C FFI preparation pass.
//
// Runs before HM inference (inside the "prepare FFI" stage of
// staged_analysis). For `c.header` imports it runs the Zig extractor, maps the
// extracted types to Workman surface types, and fills each imported spec's
// trusted boundary type — after this, C imports flow through the same
// JsImportDecl pipeline as manually typed JS imports. For `c.lib` imports the
// authored signature is already the trusted declaration and is validated only.
//
// Nominal C types (structs/enums/typedefs) become ForeignTypeDecl decls.
// Imported structs additionally get generated codec decls — a constructor
// (`newVector3`) and one getter per numeric field (`getVector3_x`) — emitted
// against byte_type-composed codecs (struct-codecs.md); nothing handwritten.

import type { Decl, JsImportSpec, JsTarget, Module, TypeExpr } from "../../ast.ts";
import { diagnosticError } from "../../diagnostics.ts";
import {
  extractCHeader,
  type ExtractedResult,
  type ExtractedType,
  type ExtractedTypeDesc,
} from "./extract.ts";
import { byValueRepresentable, cTypeName, declaredTypes, mapFn, mapValueDesc } from "./mapping.ts";

export type CExtraction = {
  header: string;
  result: ExtractedResult;
  types: Map<string, ExtractedType>;
};

// Extraction results keyed by header specifier. The emitter consults this to
// build Deno FFI symbol descriptors. Keyed per compilation run.
const extractions = new Map<string, CExtraction>();

export function cExtractionFor(header: string): CExtraction | undefined {
  return extractions.get(header);
}

export function resetCExtractions(): void {
  extractions.clear();
}

const CODEC_LIB_PREFIX = "wm-c-codec:";

export async function prepareCImports(module: Module): Promise<Module> {
  const cDecls = module.decls.filter((decl) =>
    decl.kind === "JsImportDecl" && isCTarget(decl.target)
  ) as Extract<Decl, { kind: "JsImportDecl" }>[];
  if (cDecls.length === 0) return module;

  const symbolsByHeader = new Map<string, string[]>();
  for (const decl of cDecls) {
    if (decl.target.kind !== "CHeader") continue;
    const specs = decl.clause.kind === "Named" ? decl.clause.specs : [];
    const symbols = symbolsByHeader.get(decl.target.header) ?? [];
    symbolsByHeader.set(decl.target.header, [
      ...symbols,
      ...specs.map((spec) => spec.name),
    ]);
  }
  const extractionsByHeader = new Map<string, CExtraction>();
  for (const [header, symbols] of symbolsByHeader) {
    extractionsByHeader.set(header, await extractionForHeader(header, symbols));
  }

  const foreignTypes = new Map<
    string,
    { name: string; header: string; qualifiedOnly: boolean; namespaceAliases: Set<string> }
  >();
  const registerForeignType = (
    name: string,
    header: string,
    fromNamespace: boolean,
    namespaceAlias?: string,
  ) => {
    const entry = foreignTypes.get(name);
    if (entry) {
      if (entry.qualifiedOnly && !fromNamespace) entry.qualifiedOnly = false;
    } else {
      foreignTypes.set(name, {
        name,
        header,
        qualifiedOnly: fromNamespace,
        namespaceAliases: new Set(),
      });
    }
    if (fromNamespace && namespaceAlias) {
      foreignTypes.get(name)!.namespaceAliases.add(namespaceAlias);
    }
  };
  const out: Decl[] = [];
  for (const decl of module.decls) {
    if (decl.kind !== "JsImportDecl" || !isCTarget(decl.target)) {
      out.push(decl);
      continue;
    }
    if (decl.target.kind !== "CHeader") {
      // c.lib: authored signatures are the trusted boundary; validated by HM.
      out.push(decl);
      continue;
    }
    const extraction = extractionsByHeader.get(decl.target.header)!;
    const isTypeOnly = !!decl.typeOnly;
    const isNamespace = decl.clause.kind === "Namespace";
    if (isNamespace) {
      decl.clause.specs = namespaceSpecs(extraction, declNode(decl));
    }
    for (const spec of decl.clause.kind === "Named" ? decl.clause.specs : decl.clause.specs ?? []) {
      if (isTypeOnly) {
        const name = spec.alias ?? spec.name;
        registerForeignType(name, decl.target.header, false);
        continue;
      }
      const fn = extraction.result.fns.find((entry) => entry.name === spec.name);
      const value = extraction.result.values.find((entry) => entry.name === spec.name);
      if (fn) {
        const mapped = mapFn(fn);
        if (mapped.problems.length > 0) {
          throw diagnosticError(
            new Error(`C import '${spec.name}': ${mapped.problems[0]}`),
            spec.node ?? decl.node,
            "c-ffi.unrepresentable",
          );
        }
        spec.type = mapped.type;
      } else if (value) {
        if (value.type.kind === "named") {
          // Flat numeric structs are records; constants materialize as plain
          // record objects. Non-flat structs stay pointer-backed.
          const structName = cTypeName(value.type.name ?? "");
          const struct = extraction.types.get(structName);
          spec.type = isFlatNumericStruct(struct)
            ? { kind: "TName", name: structName, args: [], node: spec.node ?? decl.node }
            : ptrType(structName, spec.node ?? decl.node);
        } else {
          const mapped = mapValueDesc(value.type, extraction.types);
          if (mapped.unsupported) {
            throw diagnosticError(
              new Error(
                `C import '${spec.name}': unrepresentable constant (${mapped.unsupported})`,
              ),
              spec.node ?? decl.node,
              "c-ffi.unrepresentable",
            );
          }
          spec.type = mapped.type;
        }
      } else {
        throw diagnosticError(
          new Error(
            `C import: symbol '${spec.name}' is not declared by header '${decl.target.header}' (it may be a macro translate-c cannot represent)`,
          ),
          spec.node ?? decl.node,
          "c-ffi.missing-symbol",
        );
      }
    }
    // Struct/enum names referenced by imported signatures need type decls.
    // Namespace-only references bind qualified (`Raylib.Vector2`); a Named
    // import makes the plain name visible.
    if (!isTypeOnly) {
      const namespaceTypeNames = new Set<string>();
      for (const spec of decl.clause.specs ?? []) {
        const type = spec.type;
        if (!type) continue;
        for (const name of collectNamedTypes(type)) {
          if (!extraction.types.has(name)) continue;
          registerForeignType(name, decl.target.header, isNamespace, decl.clause.alias);
          if (isNamespace) namespaceTypeNames.add(name);
        }
      }
      if (isNamespace && decl.clause.kind === "Namespace") {
        decl.clause.typeNames = [...namespaceTypeNames];
      }
    }
    // Library resolution: a c.header import without `lib:` derives the binary
    // from the header stem ("vec3.h" -> dir/libvec3.so, vec3.so, ...). System
    // headers (bare names) fall back to libc; local headers must resolve or
    // the import fails with the tried candidates. Imports that use no fn
    // symbols (types/constants only) need no library at all.
    if (decl.target.kind === "CHeader" && !decl.target.lib && !isTypeOnly) {
      const needsLibrary = (decl.clause.specs ?? []).some((spec) => spec.type?.kind === "TFn");
      if (needsLibrary) {
        const derived = resolveCLibrary(decl.target.header);
        if (derived) {
          decl.target.lib = derived;
        } else if (decl.target.header.includes("/") || existsSync(decl.target.header)) {
          throw diagnosticError(
            new Error(
              `C import from '${decl.target.header}': no library found (add lib: "..."; tried ${
                resolveCLibraryCandidates(decl.target.header).join(", ")
              })`,
            ),
            decl.node,
            "c-ffi.missing-library",
          );
        }
      }
    }
    out.push(decl);
  }

  // Namespace spec types referenced plain C names; namespace-only types bind
  // qualified, so rewrite their references to `<alias>.<name>`.
  for (const decl of out) {
    if (decl.kind !== "JsImportDecl" || decl.clause.kind !== "Namespace") continue;
    const alias = decl.clause.alias;
    const rewrite = new Map<string, string>();
    for (const name of decl.clause.typeNames ?? []) {
      const entry = foreignTypes.get(name);
      if (entry?.qualifiedOnly) rewrite.set(name, `${alias}.${name}`);
    }
    if (rewrite.size === 0) continue;
    const walk = (type: TypeExpr): TypeExpr => {
      if (type.kind === "TName") {
        const qualified = rewrite.get(type.name);
        return qualified ? { ...type, name: qualified } : { ...type, args: type.args.map(walk) };
      }
      if (type.kind === "TFn") {
        return {
          ...type,
          params: type.params.map(walk),
          result: walk(type.result),
        };
      }
      if (type.kind === "TTuple") return { ...type, items: type.items.map(walk) };
      return type;
    };
    for (const spec of decl.clause.specs ?? []) {
      if (spec.type) spec.type = walk(spec.type);
    }
  }

  // Generated codec decls, one synthetic import per (header, struct).
  const codecDecls: Decl[] = [];
  const byHeader = new Map<string, { name: string; declName: string }[]>();
  for (const entry of foreignTypes.values()) {
    const names = byHeader.get(entry.header) ?? [];
    for (const declName of foreignTypeDeclNames(entry)) {
      names.push({ name: entry.name, declName });
    }
    byHeader.set(entry.header, names);
  }
  for (const [header, entries] of byHeader) {
    const extraction = extractionsByHeader.get(header);
    if (!extraction) continue;
    const specs = [];
    for (const { name, declName } of entries) {
      const struct = extraction.types.get(name);
      // Only flat numeric structs get codecs; mixed structs (pointer/array
      // fields) have no numeric-only codec.
      if (!isFlatNumericStruct(struct)) continue;
      specs.push(...codecSpecsForStruct(struct, declNode(cDecls[0]), declName));
    }
    if (specs.length > 0) {
      codecDecls.push({
        kind: "JsImportDecl",
        target: { kind: "CLib", name: `${CODEC_LIB_PREFIX}${header}`, node: declNode(cDecls[0]) },
        clause: {
          kind: "Named",
          specs,
          unsafe: true,
          node: declNode(cDecls[0]),
        },
        node: declNode(cDecls[0]),
      });
    }
  }

  const typeDecls: Decl[] = [
    {
      kind: "TypeDecl" as const,
      exported: false,
      name: "Ptr",
      params: ["t"],
      ctors: [],
      node: declNode(cDecls[0]),
    },
    ...[...foreignTypes.values()].flatMap((entry): Decl[] => {
      const struct = extractionsByHeader.get(entry.header)?.types.get(entry.name);
      const isRecord = !!struct && struct.kind === "struct" &&
        struct.fields.length > 0 &&
        struct.fields.every((field) => isNumericField(field.type));
      return foreignTypeDeclNames(entry).map((declName): Decl => {
        // Flat numeric structs become Workman records so `.{ x = 1, y = 2 }`
        // literals infer against C struct parameter types
        // (namespace-records.md). Dotted decl names bind into the namespace
        // structure only.
        if (isRecord) {
          return {
            kind: "RecordDecl" as const,
            exported: true,
            name: declName,
            params: [],
            fields: struct.fields.map((field) => ({
              name: field.name,
              type: numberType(declNode(cDecls[0])),
              node: declNode(cDecls[0]),
            })),
            node: declNode(cDecls[0]),
          };
        }
        return {
          kind: "ForeignTypeDecl" as const,
          name: declName,
          foreignKey: `c:${entry.header}:${entry.name}`,
          node: declNode(cDecls[0]),
        };
      });
    }),
  ];
  return { ...module, decls: [...typeDecls, ...codecDecls, ...out] };
}

/**
 * The surface spellings a C type is bound under: the plain name when any
 * Named import references it, plus `<alias>.<name>` once per namespace
 * import that references it.
 */
function foreignTypeDeclNames(
  entry: { name: string; qualifiedOnly: boolean; namespaceAliases: Set<string> },
): string[] {
  const names = entry.qualifiedOnly ? [] : [entry.name];
  for (const alias of entry.namespaceAliases) {
    names.push(`${alias}.${entry.name}`);
  }
  return names;
}

function isFlatNumericStruct(
  struct: ExtractedType | undefined,
): struct is Extract<ExtractedType, { kind: "struct" }> {
  return !!struct && struct.kind === "struct" && struct.fields.length > 0 &&
    struct.fields.every((field) => isNumericField(field.type));
}

/**
 * Namespace imports (`import unsafe * as Raylib`) have no symbol list: the
 * extraction already enumerated the whole namespace, so every fn and value
 * becomes a typed spec. Symbols that do not map in v1 are skipped — they are
 * only reachable by name, and a named import would diagnose them.
 */
function namespaceSpecs(
  extraction: CExtraction,
  node: Decl["node"],
): JsImportSpec[] {
  const specs: JsImportSpec[] = [];
  for (const fn of extraction.result.fns) {
    if (
      !fn.params.every((param) => byValueRepresentable(param, extraction.types)) ||
      !byValueRepresentable(fn.return, extraction.types)
    ) {
      continue;
    }
    const mapped = mapFn(fn);
    if (mapped.problems.length > 0) continue;
    specs.push({ name: fn.name, type: mapped.type, node });
  }
  for (const value of extraction.result.values) {
    if (value.type.kind === "named") {
      const structName = cTypeName(value.type.name ?? "");
      const struct = extraction.types.get(structName);
      if (!isFlatNumericStruct(struct)) continue;
      specs.push({
        name: value.name,
        type: { kind: "TName", name: structName, args: [], node },
        node,
      });
      continue;
    }
    const mapped = mapValueDesc(value.type, extraction.types);
    if (mapped.unsupported) continue;
    specs.push({ name: value.name, type: mapped.type, node });
  }
  return specs;
}

function codecSpecsForStruct(
  struct: Extract<ExtractedType, { kind: "struct" }>,
  node: Decl["node"],
  declName = struct.name,
): { name: string; type: TypeExpr; node?: Decl["node"] }[] {
  const specs: { name: string; type: TypeExpr; node?: Decl["node"] }[] = [];
  const ptr = () => ptrType(declName, node);
  specs.push({
    name: `new${struct.name}`,
    type: {
      kind: "TFn",
      params: struct.fields.map(() => numberType(node)),
      result: ptr(),
      node,
    },
    node,
  });
  for (const field of struct.fields) {
    if (!isNumericField(field.type)) continue;
    specs.push({
      name: `get${struct.name}_${field.name}`,
      type: { kind: "TFn", params: [ptr()], result: numberType(node), node },
      node,
    });
  }
  return specs;
}

function isNumericField(desc: ExtractedTypeDesc): boolean {
  return desc.kind === "int" || desc.kind === "float" || desc.kind === "bool";
}

function numberType(node: Decl["node"]): TypeExpr {
  return { kind: "TName", name: "Number", args: [], node };
}

function ptrType(inner: string, node: Decl["node"]): TypeExpr {
  return {
    kind: "TName",
    name: "Ptr",
    args: [{ kind: "TName", name: inner, args: [], node }],
    node,
  };
}

function declNode(decl: Extract<Decl, { kind: "JsImportDecl" }>): Decl["node"] {
  return decl.node;
}

const C_LIBRARY_EXTENSIONS = [".so", ".dylib", ".dll"];

/**
 * Candidate paths for a header-derived library: `<dir>/lib<stem>.so` first
 * (standard build output layout), then `<dir>/<stem>.so`, for every platform
 * extension. Emits bare candidates (`.so`-suffixed) plus extensionless forms
 * the OS loader can resolve.
 */
function resolveCLibraryCandidates(header: string): string[] {
  const dir = header.includes("/") ? header.slice(0, header.lastIndexOf("/")) : "";
  const file = header.slice(header.lastIndexOf("/") + 1);
  const stem = file.replace(/\.h+$/, "").replace(/^lib/, "");
  const prefixes = ["lib", ""];
  const candidates: string[] = [];
  for (const prefix of prefixes) {
    for (const extension of C_LIBRARY_EXTENSIONS) {
      candidates.push(dir ? `${dir}/${prefix}${stem}${extension}` : `${prefix}${stem}${extension}`);
    }
  }
  return candidates;
}

function resolveCLibrary(header: string): string | undefined {
  // System headers (stdio.h etc.) resolve through the default libc path.
  // Bare names that exist relative to the cwd are project-local.
  const local = header.includes("/") || existsSync(header);
  if (!local) return undefined;
  for (const candidate of resolveCLibraryCandidates(header)) {
    if (existsSync(candidate)) {
      // dlopen treats bare names as SONAMEs (system search only); local
      // files must be ./-relative.
      return candidate.includes("/") ? candidate : `./${candidate}`;
    }
  }
  return undefined;
}

function existsSync(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

async function extractionForHeader(header: string, symbols: string[]): Promise<CExtraction> {
  const cached = extractions.get(header);
  if (cached) return cached;
  let result = await extractCHeader({ header, symbols });
  let types = declaredTypes(result);
  // Functions may reference struct types that were not imported by name;
  // their layouts are needed for codecs. Re-extract once with the missing
  // names added (extraction is cached per symbol list, so this is cheap).
  const missing = missingNamedTypes(result, types);
  if (missing.size > 0) {
    result = await extractCHeader({
      header,
      symbols: [...new Set([...symbols, ...missing])],
    });
    types = declaredTypes(result);
  }
  const entry: CExtraction = { header, result, types };
  extractions.set(header, entry);
  return entry;
}

function missingNamedTypes(
  result: ExtractedResult,
  types: Map<string, ExtractedType>,
): Set<string> {
  const missing = new Set<string>();
  const consider = (name: string | undefined) => {
    if (!name) return;
    const normalized = cTypeName(name);
    if (!types.has(normalized)) missing.add(normalized);
  };
  const walk = (desc: ExtractedTypeDesc) => {
    if (desc.kind === "named") consider(desc.name);
    if (desc.child) walk(desc.child);
  };
  for (const fn of result.fns) {
    for (const param of fn.params) walk(param);
    if (fn.return) walk(fn.return);
  }
  return missing;
}

function collectNamedTypes(type: TypeExpr): string[] {
  switch (type.kind) {
    case "TName":
      return [type.name, ...type.args.flatMap(collectNamedTypes)];
    case "TTuple":
      return type.items.flatMap(collectNamedTypes);
    case "TFn":
      return [...type.params.flatMap(collectNamedTypes), ...collectNamedTypes(type.result)];
    case "TVar":
      return [];
  }
}

function isCTarget(target: JsTarget): boolean {
  return target.kind === "CHeader" || target.kind === "CLib";
}

export { CODEC_LIB_PREFIX, cTypeName };
