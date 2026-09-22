// Mapping from extractor JSON type descriptors to Workman surface TypeExpr.
//
// V1 simplifications (documented in markdown/c_ffi/type-mapping.md):
// - C integers map to Workman `Number` — width info lives in the ABI descriptor
//   the codegen emits, not in the type (wm-mini has no width-typed ints yet).
// - Every C pointer is `Option<Ptr<T>>`, uniformly: Deno.PointerValue is
//   `null | PointerObject` at runtime, and C has no nullability signal.
// - `anyopaque`/`void*` map to `Option<Ptr<Opaque>>`; known-name C types keep
//   their own nominal names (never collapsed into Opaque).

import type { TypeExpr } from "../../ast.ts";
import type { ExtractedStruct, ExtractedType, ExtractedTypeDesc } from "./extract.ts";

export type MappedType = {
  type: TypeExpr;
  /** True when the mapped Workman value is a pointer (wrapped in Option). */
  pointer: boolean;
  /** C-level char pointer, for string conversion at the ABI boundary. */
  charPointer: boolean;
  /** Non-representable in v1; carries the reflected C type text for diagnostics. */
  unsupported?: string;
};

const INT_MAX_BITS = 64;

export function mapTypeDesc(
  desc: ExtractedTypeDesc,
  types: Map<string, ExtractedType>,
  position: "param" | "return" | "field" | "value" = "param",
): MappedType {
  switch (desc.kind) {
    case "bool":
      return plain("Bool");
    case "void":
      return position === "return"
        ? plain("Void")
        : { ...plain("Void"), unsupported: "void value parameter" };
    case "int":
      return plain("Number");
    case "float":
      return plain("Number");
    case "pointer": {
      const child = desc.child;
      if (!child) return unknownType(desc);
      if (child.kind === "void") return opaquePointer();
      if (child.kind === "int" && isChar(child)) return charPointer();
      if (child.kind === "named") {
        return namedPointer(child.name ? cTypeName(child.name) : "Opaque");
      }
      const inner = mapTypeDesc(child, types, "value");
      if (inner.unsupported) return { ...inner, pointer: true };
      // Pointers to scalars: Option<Ptr<Number|Bool>>.
      return pointerOf(inner.type);
    }
    case "array":
      // C array parameters decay to pointers; as values they are not mapped in v1.
      return {
        ...unknownType(desc),
        unsupported: "C array value in this position",
      };
    case "named":
      return plain(cTypeName(desc.name ?? "Opaque"));
    case "optional":
      // Optional pointers (Zig-side only) are treated as plain pointers: the
      // uniform Option wrap already covers nullability.
      return desc.child ? mapTypeDesc(desc.child, types, position) : unknownType(desc);
    case "unknown":
      return unknownType(desc);
    default:
      return unknownType(desc);
  }
}

export function mapFn(
  fn: { name: string; params: ExtractedTypeDesc[]; return: ExtractedTypeDesc | null },
): { type: TypeExpr; problems: string[] } {
  const problems: string[] = [];
  const params: TypeExpr[] = [];
  for (const param of fn.params) {
    const mapped = mapTypeDesc(param, new Map(), "param");
    if (mapped.unsupported) {
      problems.push(`${fn.name}: unrepresentable parameter (${mapped.unsupported})`);
      continue;
    }
    params.push(mapped.type);
  }
  let result = plain("Void").type;
  if (fn.return && fn.return.kind !== "void") {
    const mapped = mapTypeDesc(fn.return, new Map(), "return");
    if (mapped.unsupported) {
      problems.push(`${fn.name}: unrepresentable return type (${mapped.unsupported})`);
    } else {
      result = mapped.type;
    }
  }
  return { type: { kind: "TFn", params, result }, problems };
}

/** The Workman type of an imported C constant. */
export function mapValueDesc(
  desc: ExtractedTypeDesc,
  types: Map<string, ExtractedType>,
): MappedType {
  if (desc.kind === "named") {
    return plain(cTypeName(desc.name ?? "Opaque"));
  }
  if (desc.kind === "int" || desc.kind === "float") return plain("Number");
  if (desc.kind === "bool") return plain("Bool");
  return unknownType(desc);
}

function plain(name: string): MappedType {
  return { type: { kind: "TName", name, args: [] }, pointer: false, charPointer: false };
}

function pointerOf(inner: TypeExpr): MappedType {
  return {
    type: { kind: "TName", name: "Option", args: [{ kind: "TName", name: "Ptr", args: [inner] }] },
    pointer: true,
    charPointer: false,
  };
}

function opaquePointer(): MappedType {
  return pointerOf({ kind: "TName", name: "Opaque", args: [] });
}

function namedPointer(name: string): MappedType {
  return pointerOf({ kind: "TName", name, args: [] });
}

function charPointer(): MappedType {
  return { type: plain("String").type, pointer: true, charPointer: true };
}

function unknownType(desc: ExtractedTypeDesc): MappedType {
  return {
    type: { kind: "TName", name: "Void", args: [] },
    pointer: false,
    charPointer: false,
    unsupported: `reflected C type ${desc.kind}${desc.name ? ` (${desc.name})` : ""}`,
  };
}

function isChar(desc: ExtractedTypeDesc): boolean {
  return desc.kind === "int" && desc.bits === 8;
}

/** `cimport.struct_Vector3` → `Vector3`; `cimport.FOO` → `FOO`. */
export function cTypeName(name: string): string {
  const withoutPrefix = name.replace(/^cimport\.(struct_|union_|enum_)/, "");
  return withoutPrefix.replace(/^cimport\./, "");
}

/** Struct and enum types declared by an extraction, by their C name. */
export function declaredTypes(result: { types: ExtractedType[] }): Map<string, ExtractedType> {
  const map = new Map<string, ExtractedType>();
  for (const type of result.types) map.set(type.name, type);
  return map;
}

export function structByName(
  types: Map<string, ExtractedType>,
  name: string,
): ExtractedStruct | undefined {
  const declared = types.get(name);
  return declared && declared.kind === "struct" ? declared : undefined;
}

export function intBitsFits(bits: number | undefined): boolean {
  return bits === undefined || bits <= INT_MAX_BITS;
}

/**
 * Whether a by-value position (parameter or return) of this descriptor has a
 * v1 ABI representation: flat numeric structs, enums (their backing int), or
 * anything already covered by the scalar mapping.
 */
export function byValueRepresentable(
  desc: ExtractedTypeDesc | null,
  types: Map<string, ExtractedType>,
): boolean {
  if (!desc) return true;
  switch (desc.kind) {
    case "named": {
      const declared = types.get(cTypeName(desc.name ?? ""));
      if (!declared) return false;
      if (declared.kind === "enum") return true;
      if (declared.kind === "alias") return byValueRepresentable(declared.target, types);
      return declared.kind === "struct" &&
        declared.fields.length > 0 &&
        declared.fields.every((field) =>
          field.type.kind === "int" || field.type.kind === "float" || field.type.kind === "bool"
        );
    }
    case "optional":
      return desc.child ? byValueRepresentable(desc.child, types) : false;
    case "unknown":
      return false;
    default:
      return true;
  }
}
