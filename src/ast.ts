export type Module = { kind: "Module"; decls: Decl[] };

export type Decl =
  | { kind: "ImportDecl"; path: string; clause: ImportClause }
  | { kind: "LetDecl"; exported: boolean; recursive: boolean; bindings: Binding[] }
  | {
    kind: "RecordDecl";
    exported: boolean;
    name: string;
    params: string[];
    fields: RecordFieldDecl[];
  }
  | {
    kind: "TypeDecl";
    exported: boolean;
    name: string;
    params: string[];
    ctors: CtorDecl[];
    alias?: TypeExpr;
    hasLeadingPipe?: boolean;
  };

export type ImportClause =
  | { kind: "Namespace"; alias: string }
  | { kind: "Named"; specs: ImportSpec[] };
export type ImportSpec = { name: string; alias?: string };
export type Binding = { pattern: Pattern; annotation?: TypeExpr; value: Expr };
export type CtorDecl = { name: string; args: TypeExpr[] };
export type RecordFieldDecl = { name: string; type: TypeExpr };
export type Param = { pattern: Pattern; annotation?: TypeExpr };

export type Expr =
  | { kind: "Int"; value: number }
  | { kind: "Float"; value: number }
  | { kind: "String"; value: string }
  | { kind: "Bool"; value: boolean }
  | { kind: "Void" }
  | { kind: "Var"; name: string }
  | { kind: "Tuple"; items: Expr[] }
  | { kind: "Record"; fields: RecordExprField[] }
  | { kind: "Lambda"; params: Param[]; body: Expr }
  | { kind: "Call"; callee: Expr; args: Expr[] }
  | { kind: "If"; cond: Expr; thenExpr: Expr; elseExpr: Expr }
  | { kind: "Match"; value: Expr; arms: MatchArm[] }
  | { kind: "Block"; items: (Decl | Expr)[]; result: Expr }
  | { kind: "Binary"; op: string; left: Expr; right: Expr }
  | { kind: "Unary"; op: string; value: Expr };

export type RecordExprField = { name: string; value: Expr };
export type MatchArm = { pattern: Pattern; body: Expr };

export type Pattern =
  | { kind: "PWildcard" }
  | { kind: "PVar"; name: string }
  | { kind: "PInt"; value: number }
  | { kind: "PString"; value: string }
  | { kind: "PBool"; value: boolean }
  | { kind: "PVoid" }
  | { kind: "PPinned"; name: string }
  | { kind: "PTuple"; items: Pattern[] }
  | { kind: "PRecord"; fields: RecordPatternField[] }
  | { kind: "PCtor"; name: string; args: Pattern[] };

export type RecordPatternField = { name: string; pattern: Pattern };
export type TypeExpr =
  | { kind: "TName"; name: string; args: TypeExpr[] }
  | { kind: "TVar"; name: string }
  | { kind: "TTuple"; items: TypeExpr[] }
  | { kind: "TFn"; params: TypeExpr[]; result: TypeExpr };
