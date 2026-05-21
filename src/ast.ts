export type Module = { kind: "Module"; decls: Decl[] };

export type Decl =
  | { kind: "ImportDecl"; path: string; alias: string }
  | { kind: "LetDecl"; recursive: boolean; bindings: Binding[] }
  | { kind: "TypeDecl"; name: string; params: string[]; ctors: CtorDecl[] };

export type Binding = { pattern: Pattern; annotation?: TypeExpr; value: Expr };
export type CtorDecl = { name: string; args: TypeExpr[] };

export type Expr =
  | { kind: "Int"; value: number }
  | { kind: "Float"; value: number }
  | { kind: "String"; value: string }
  | { kind: "Bool"; value: boolean }
  | { kind: "Void" }
  | { kind: "Var"; name: string }
  | { kind: "Tuple"; items: Expr[] }
  | { kind: "Lambda"; params: Pattern[]; body: Expr }
  | { kind: "Call"; callee: Expr; args: Expr[] }
  | { kind: "If"; cond: Expr; thenExpr: Expr; elseExpr: Expr }
  | { kind: "Match"; value: Expr; arms: MatchArm[] }
  | { kind: "Block"; statements: (Decl | Expr)[]; result: Expr }
  | { kind: "Binary"; op: string; left: Expr; right: Expr }
  | { kind: "Unary"; op: string; value: Expr };

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
  | { kind: "PCtor"; name: string; args: Pattern[] };

export type TypeExpr =
  | { kind: "TName"; name: string; args: TypeExpr[] }
  | { kind: "TVar"; name: string }
  | { kind: "TTuple"; items: TypeExpr[] }
  | { kind: "TFn"; params: TypeExpr[]; result: TypeExpr };
