import type { AstNode, SourceSpan } from "./source.ts";

export type Located<T> = T & { node?: AstNode };

export type Module = Located<{ kind: "Module"; decls: Decl[] }>;

export type Decl =
  | Located<{ kind: "ImportDecl"; path: string; pathNode?: AstNode; clause: ImportClause }>
  | Located<{ kind: "JsImportDecl"; target: JsTarget; clause: JsImportClause; typeOnly?: boolean }>
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
  | Located<{ kind: "JsModule"; specifier: string }>
  | Located<{ kind: "JsReceiver"; path: string[] }>
  | Located<{ kind: "JsConstructor"; path: string }>;
export type JsImportClause =
  | Located<{ kind: "Namespace"; alias: string; unsafe?: boolean }>
  | Located<{ kind: "Named"; specs: JsImportSpec[]; alias?: string; unsafe?: boolean }>;
export type JsImportSpec = Located<{
  name: string;
  alias?: string;
  type?: TypeExpr;
  fallible?: boolean;
}>;
export type Binding = Located<{ pattern: Pattern; annotation?: TypeExpr; value: Expr }>;
export type CtorDecl = Located<{ name: string; args: TypeExpr[] }>;
export type RecordFieldDecl = Located<{ name: string; type: TypeExpr }>;
export type Param = Located<{ pattern: Pattern; annotation?: TypeExpr }>;

export type Expr =
  | Located<{ kind: "Int"; value: number }>
  | Located<{ kind: "Float"; value: number }>
  | Located<{ kind: "String"; value: string }>
  | Located<{ kind: "Bool"; value: boolean }>
  | Located<{ kind: "Void"; implicitStatement?: Expr; implicitTerminatorSpan?: SourceSpan }>
  | Located<{ kind: "Var"; name: string }>
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
  | Located<{ kind: "Lambda"; params: Param[]; body: Expr }>
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
  | Located<{ kind: "PPinned"; name: string }>
  | Located<{ kind: "PTuple"; items: Pattern[] }>
  | Located<{ kind: "PRecord"; fields: RecordPatternField[] }>
  | Located<{ kind: "PCtor"; name: string; args: Pattern[] }>;

export type RecordPatternField = Located<{ name: string; pattern: Pattern }>;
export type TypeExpr =
  | Located<{ kind: "TName"; name: string; args: TypeExpr[] }>
  | Located<{ kind: "TVar"; name: string }>
  | Located<{ kind: "TTuple"; items: TypeExpr[] }>
  | Located<{ kind: "TFn"; params: TypeExpr[]; result: TypeExpr }>;
