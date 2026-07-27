import type { AstNode, SourceSpan } from "./source.ts";

export type Located<T> = T & { node?: AstNode };

/**
 * A Revised Definition long identifier.
 *
 * The Definition (Section 2.4, "Identifiers") gives long identifiers the shape
 *
 * ```text
 * LongX = StrId* x X
 * longx ::= x | strid_1. ... .strid_n.x   (n >= 1)
 * ```
 *
 * and defines lookup as iterated structure-environment projection followed by a
 * lookup in the component environment (Section 4.3): for
 * `longvid = strid_1. ... .strid_k.vid`, `E(longvid)` projects `SE` k times and
 * then applies `VE`.
 *
 * `qualifiers` is therefore the `StrId*` prefix and `id` is the base identifier.
 * An unqualified identifier has no qualifiers. This is the semantic object; the
 * dotted spelling is a display/emit rendering of it and is never a semantic key.
 *
 * Host member paths (JavaScript FFI receivers, GPU intrinsic names, reflected
 * foreign-type keys) are not SML long identifiers and keep their own
 * representation.
 */
export type LongId = Readonly<{ qualifiers: readonly string[]; id: string }>;

/** The long identifier for an unqualified name. */
export function longId(id: string): LongId {
  return { qualifiers: [], id };
}

/** The authored/display spelling of a long identifier. Never a semantic key. */
export function longIdSpelling(path: LongId): string {
  return path.qualifiers.length === 0 ? path.id : `${path.qualifiers.join(".")}.${path.id}`;
}

/** True when the long identifier is qualified by at least one structure identifier. */
export function isQualified(path: LongId): boolean {
  return path.qualifiers.length > 0;
}

/**
 * The long identifier of a source node carrying one.
 *
 * Source-derived nodes always carry an explicit `path` from the parser. Nodes
 * built programmatically by desugaring and FFI lowering may omit it; this is the
 * single place permitted to recover the structure from a dotted spelling, so
 * that semantic code never splits names itself.
 */
export function pathOf(node: { name: string; path?: LongId }): LongId {
  return node.path ?? parseLongId(node.name);
}

/**
 * Recover a long identifier from a dotted spelling.
 *
 * This is for *constructing* long identifiers from compiler-owned tables whose
 * keys are authored as dotted text (the basis manifest, standard-structure
 * member tables). It is not a name resolver: semantic lookup consumes a `LongId`
 * and never re-derives one from a rendered name.
 */
export function parseLongId(spelling: string): LongId {
  const parts = spelling.split(".");
  return { qualifiers: parts.slice(0, -1), id: parts.at(-1)! };
}

export type Module = Located<{
  kind: "Module";
  decls: Decl[];
  prelude?: "none";
}>;

export type Decl =
  | Located<{ kind: "ImportDecl"; path: string; pathNode?: AstNode; clause: ImportClause }>
  | Located<{
    kind: "JsImportDecl";
    target: JsTarget;
    clause: JsImportClause;
    typeOnly?: boolean;
    /** Authored clause retained when FFI lowering replaces it with compiler-only imports. */
    sourceClause?: JsImportClause;
  }>
  | Located<{ kind: "ForeignTypeDecl"; name: string; foreignKey?: string }>
  | Located<{ kind: "LetDecl"; exported: boolean; recursive: boolean; bindings: Binding[] }>
  | Located<{
    kind: "RecordDecl";
    exported: boolean;
    name: string;
    params: string[];
    fields: RecordFieldDecl[];
  }>
  | Located<{
    kind: "TypeDecl";
    exported: boolean;
    name: string;
    params: string[];
    ctors: CtorDecl[];
    alias?: TypeExpr;
    hasLeadingPipe?: boolean;
  }>;

export type ImportClause =
  | Located<{ kind: "Namespace"; alias: string }>
  | Located<{ kind: "All" }>
  | Located<{ kind: "Named"; specs: ImportSpec[] }>;
export type ImportSpec = Located<{ name: string; alias?: string }>;
export type JsTarget =
  | Located<{ kind: "JsGlobalRoot" }>
  | Located<{ kind: "JsGlobal"; path: string }>
  | Located<{ kind: "JsMeta" }>
  | Located<{ kind: "JsModule"; specifier: string }>
  | Located<{ kind: "JsWorker"; specifier: string }>
  | Located<{ kind: "JsReceiver"; path: string[] }>
  | Located<{ kind: "JsConstructor"; path: string }>;
export type JsImportClause =
  | Located<{ kind: "Namespace"; alias: string; unsafe?: boolean }>
  | Located<{ kind: "Named"; specs: JsImportSpec[]; alias?: string; unsafe?: boolean }>;
export type JsImportSpec = Located<{
  name: string;
  alias?: string;
  /**
   * Authored local name retained by FFI-generated import variants.
   *
   * Generated aliases use this to retain a compiler-owned semantic relation and source mapping to
   * the import spec that caused them to exist. Their lowering binding remains distinct.
   */
  sourceName?: string;
  type?: TypeExpr;
  fallible?: boolean;
}>;
export type Binding = Located<{ pattern: Pattern; annotation?: TypeExpr; value: Expr }>;
export type CtorDecl = Located<{ name: string; args: TypeExpr[] }>;
export type RecordFieldDecl = Located<{ name: string; type: TypeExpr }>;
export type Param = Located<{ pattern: Pattern; annotation?: TypeExpr }>;
export type Directive = Located<{ name: string }>;

export type Expr =
  | Located<{ kind: "Int"; value: number }>
  | Located<{ kind: "Float"; value: number }>
  | Located<{ kind: "String"; value: string }>
  | Located<{ kind: "Bool"; value: boolean }>
  | Located<{ kind: "Void"; implicitStatement?: Expr; implicitTerminatorSpan?: SourceSpan }>
  | Located<{
    kind: "Var";
    name: string;
    /** The Definition's `longvid`. Semantic lookup uses this, never `name`. */
    path?: LongId;
    /** Authored spelling retained when lowering replaces `name` with a compiler-only binding. */
    sourceName?: string;
  }>
  | Located<{ kind: "Tuple"; items: Expr[] }>
  | Located<{ kind: "Record"; fields: RecordExprItem[] }>
  | Located<{ kind: "JsonObject"; fields: JsonObjectField[] }>
  | Located<{ kind: "JsonArray"; items: Expr[] }>
  | Located<{ kind: "FfiGet"; receiver: Expr; path: string[] }>
  | Located<{ kind: "FfiCall"; receiver: Expr; path: string[]; args: Expr[] }>
  | Located<{
    kind: "FfiBindingCall";
    name: string;
    args: Expr[];
    effect?: "Result" | "Task";
  }>
  | Located<{
    kind: "Lambda";
    params: Param[];
    directives: Directive[];
    body: Expr;
    returnAnnotation?: TypeExpr;
    trailingReturnAnnotation?: TypeExpr;
  }>
  | Located<{ kind: "Call"; callee: Expr; args: Expr[] }>
  | Located<{ kind: "If"; cond: Expr; thenExpr: Expr; elseExpr: Expr }>
  | Located<{ kind: "Match"; value: Expr; arms: MatchArm[] }>
  | Located<{ kind: "Panic"; message: Expr }>
  | Located<{ kind: "Block"; items: (Decl | Expr)[]; result: Expr }>
  | Located<{ kind: "Binary"; op: string; left: Expr; right: Expr }>
  | Located<{ kind: "Unary"; op: string; value: Expr }>
  | Located<{ kind: "Pipe"; left: Expr; right: Expr }>;

export type RecordExprItem =
  | Located<{ kind: "Field"; name: string; value: Expr }>
  | Located<{ kind: "Spread"; value: Expr }>;
export type RecordExprField = Extract<RecordExprItem, { kind: "Field" }>;
export type RecordExprSpread = Extract<RecordExprItem, { kind: "Spread" }>;
export type JsonObjectField = Located<{ key: string; value: Expr }>;
export type MatchArm = Located<{ pattern: Pattern; body: Expr }>;

export type Pattern =
  | Located<{ kind: "PWildcard" }>
  | Located<{ kind: "PVar"; name: string }>
  | Located<{ kind: "PInt"; value: number }>
  | Located<{ kind: "PString"; value: string }>
  | Located<{ kind: "PBool"; value: boolean }>
  | Located<{ kind: "PVoid" }>
  | Located<{ kind: "PPinned"; name: string; path?: LongId }>
  | Located<{ kind: "PTuple"; items: Pattern[] }>
  | Located<{ kind: "PRecord"; fields: RecordPatternField[] }>
  | Located<{ kind: "PCtor"; name: string; path?: LongId; args: Pattern[] }>;

export type RecordPatternField = Located<{ name: string; pattern: Pattern }>;
export type TypeExpr =
  | Located<{ kind: "TName"; name: string; path?: LongId; args: TypeExpr[] }>
  | Located<{ kind: "TVar"; name: string }>
  | Located<{ kind: "TTuple"; items: TypeExpr[] }>
  | Located<{ kind: "TFn"; params: TypeExpr[]; result: TypeExpr }>;
