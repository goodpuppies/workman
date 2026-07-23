import type { AstNode } from "../source.ts";
import type { JsImportClause, JsTarget, TypeExpr } from "../ast.ts";
import type { BindingId, CtorId, RecordId, TypeNameId } from "./ids.ts";
import type { VisualShaderArtifactV1 } from "../gpu_artifact.ts";

export type CoreModule = {
  kind: "CoreModule";
  decls: CoreDecl[];
  node?: AstNode;
};

export type CoreDecl =
  | { kind: "CoreImport"; path: string; node?: AstNode }
  | {
    kind: "CoreJsImport";
    clause: JsImportClause;
    target: JsTarget;
    node?: AstNode;
  }
  | {
    kind: "CoreLet";
    exported: boolean;
    recursive: boolean;
    bindings: CoreBinding[];
    node?: AstNode;
  }
  | {
    kind: "CoreType";
    exported: boolean;
    name: string;
    typeNameId?: TypeNameId;
    params: string[];
    ctors: CoreCtorDecl[];
    alias?: TypeExpr;
    node?: AstNode;
  }
  | {
    kind: "CoreRecord";
    exported: boolean;
    name: string;
    constructorBindingId?: BindingId;
    typeNameId?: TypeNameId;
    recordId?: RecordId;
    params: string[];
    fields: CoreRecordFieldDecl[];
    node?: AstNode;
  };

export type CoreBinding = {
  pattern: CorePattern;
  annotation?: TypeExpr;
  value: CoreExpr;
  node?: AstNode;
};

export type CoreCtorDecl = {
  id?: CtorId;
  name: string;
  payload?: TypeExpr;
  node?: AstNode;
};

export type CoreRecordFieldDecl = {
  name: string;
  type: TypeExpr;
  node?: AstNode;
};

export type CoreExpr =
  | { kind: "CoreInt"; value: number; node?: AstNode }
  | { kind: "CoreFloat"; value: number; node?: AstNode }
  | { kind: "CoreString"; value: string; node?: AstNode }
  | { kind: "CoreBool"; value: boolean; node?: AstNode }
  | { kind: "CoreVoid"; node?: AstNode }
  | {
    kind: "CoreShaderRef";
    artifactId: VisualShaderArtifactV1["id"];
    environment?: CoreExpr;
    node?: AstNode;
  }
  | { kind: "CoreVar"; name: string; bindingId?: BindingId; ctorId?: CtorId; node?: AstNode }
  | { kind: "CoreTuple"; items: CoreExpr[]; node?: AstNode }
  | { kind: "CoreRecord"; fields: CoreRecordExprItem[]; node?: AstNode }
  | { kind: "CoreRecordAccess"; record: CoreExpr; field: string; node?: AstNode }
  | { kind: "CoreJsonObject"; fields: CoreJsonObjectField[]; node?: AstNode }
  | { kind: "CoreJsonArray"; items: CoreExpr[]; node?: AstNode }
  | { kind: "CoreFn"; arms: CoreMatchArm[]; node?: AstNode }
  | { kind: "CoreApp"; callee: CoreExpr; arg: CoreExpr; node?: AstNode }
  | { kind: "CoreIf"; cond: CoreExpr; thenExpr: CoreExpr; elseExpr: CoreExpr; node?: AstNode }
  | { kind: "CoreMatch"; value: CoreExpr; arms: CoreMatchArm[]; node?: AstNode }
  | { kind: "CorePanic"; message: CoreExpr; node?: AstNode }
  | { kind: "CoreBlock"; items: (CoreDecl | CoreExpr)[]; result: CoreExpr; node?: AstNode };

export type CoreRecordExprItem =
  | { kind: "CoreRecordField"; name: string; value: CoreExpr; node?: AstNode }
  | { kind: "CoreRecordSpread"; value: CoreExpr; node?: AstNode };
export type CoreRecordExprField = Extract<CoreRecordExprItem, { kind: "CoreRecordField" }>;
export type CoreRecordExprSpread = Extract<CoreRecordExprItem, { kind: "CoreRecordSpread" }>;

export type CoreJsonObjectField = {
  key: string;
  value: CoreExpr;
  node?: AstNode;
};

export type CoreMatchArm = {
  pattern: CorePattern;
  body: CoreExpr;
  node?: AstNode;
};

export type CorePattern =
  | { kind: "CorePWildcard"; node?: AstNode }
  | { kind: "CorePVar"; name: string; bindingId?: BindingId; node?: AstNode }
  | { kind: "CorePInt"; value: number; node?: AstNode }
  | { kind: "CorePString"; value: string; node?: AstNode }
  | { kind: "CorePBool"; value: boolean; node?: AstNode }
  | { kind: "CorePVoid"; node?: AstNode }
  | { kind: "CorePPinned"; name: string; bindingId?: BindingId; node?: AstNode }
  | { kind: "CorePTuple"; items: CorePattern[]; node?: AstNode }
  | { kind: "CorePRecord"; fields: CoreRecordPatternField[]; node?: AstNode }
  | { kind: "CorePCtor"; name: string; ctorId?: CtorId; payload?: CorePattern; node?: AstNode };

export type CoreRecordPatternField = {
  name: string;
  pattern: CorePattern;
  node?: AstNode;
};
