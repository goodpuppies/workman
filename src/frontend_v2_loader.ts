export const FRONTEND_V2_SCHEMA_VERSION = 1;

export type FrontendV2TokenKind =
  | "let"
  | "keyword"
  | "identifier"
  | "constructor"
  | "number"
  | "string"
  | "equals"
  | "semicolon"
  | "punctuation"
  | "operator"
  | "whitespace"
  | "comment"
  | "opaque"
  | "eof";

export type FrontendV2Token = {
  kind: FrontendV2TokenKind;
  text: string;
  start: number;
  end: number;
  origin: "concrete" | "virtual";
};

export type LexRoundTripResult = {
  schemaVersion: typeof FRONTEND_V2_SCHEMA_VERSION;
  sourceLength: number;
  lineStarts: number[];
  tokens: FrontendV2Token[];
  rendered: string;
};

export type FrontendV2 = {
  lexRoundTrip(source: string): LexRoundTripResult;
  parseStructural(source: string): StructuralParseResult;
  projectSemantic(source: string): SemanticProjectionResult;
};

export type StructuralItem = {
  kind: "let" | "import" | "type" | "record" | "opaque";
  id: number;
  start: number;
  end: number;
  recoveryId: number;
  patternKind: "" | "name" | "hole" | "error";
  patternRecoveryId: number;
  expressionKind: "" | "atom" | "hole" | "authored-hole" | "error";
  expressionRecoveryId: number;
  expressionSurfaceKind: "" | "literal" | "name" | "opaque" | "hole" | "authored-hole" | "error";
  expressionNameParts: string[];
  expressionRootId: number;
  expressionNodes: SurfaceNode[];
  terminatorRecoveryId: number;
};

export type SurfaceNode = {
  id: number;
  kind:
    | "literal"
    | "void"
    | "name"
    | "apply"
    | "tuple"
    | "paren"
    | "lambda"
    | "block"
    | "opaque"
    | "hole"
    | "authored-hole"
    | "error"
    | "pattern.name"
    | "pattern.wildcard"
    | "pattern.void"
    | "pattern.tuple"
    | "pattern.hole"
    | "pattern.error";
  start: number;
  end: number;
  pairId: number;
  recoveryId: number;
  children: number[];
  nameParts: string[];
};

export type StructuralRecoveryMark = {
  id: number;
  code: string;
  phase: string;
  anchor: number;
  rule: string;
  rulePath: string;
  subject: number;
  expectation: string;
  observation: string;
  recovery: string;
  fallbackNode: number;
  fallbackCategory: string;
  severity: "error" | "warning" | "hint";
  repairClass: "autoFix" | "optionalCanonical" | "recoveryOnly";
  hasRepair: boolean;
  repairText: string;
  pairId: number;
  order: number;
  dependsOn: number[];
};

export type StructuralArtifact = {
  recoveryId: number;
  anchor: number;
  text: string;
  reason: string;
  repairClass: StructuralRecoveryMark["repairClass"];
  pairId: number;
  order: number;
};

export type StructuralMapPiece = {
  kind: "concrete" | "virtual";
  recoveryId: number;
  concreteStart: number;
  concreteEnd: number;
  virtualStart: number;
  virtualEnd: number;
};

export type StructuralParseResult = {
  schemaVersion: typeof FRONTEND_V2_SCHEMA_VERSION;
  sourceLength: number;
  progressSteps: number;
  concreteText: string;
  virtualText: string;
  items: StructuralItem[];
  marks: StructuralRecoveryMark[];
  artifacts: StructuralArtifact[];
  pieces: StructuralMapPiece[];
};

export type SemanticDeclStatus = "complete" | "recovered" | "error" | "opaque";

export type SemanticDeclProjection = {
  structuralId: number;
  structuralKind: StructuralItem["kind"];
  semanticKind: "LetDecl" | "ImportDecl" | "TypeDecl" | "RecordDecl" | "ErrorDecl";
  status: SemanticDeclStatus;
  recursive: boolean;
  start: number;
  end: number;
  recoveryId: number;
  patternKind: StructuralItem["patternKind"];
  patternText: string;
  patternRecoveryId: number;
  annotationText: string;
  groupTailText: string;
  expressionKind: StructuralItem["expressionKind"];
  expressionText: string;
  expressionRecoveryId: number;
  authoredExpressionHole: boolean;
};

export type SemanticProjectionResult = {
  schemaVersion: typeof FRONTEND_V2_SCHEMA_VERSION;
  sourceLength: number;
  moduleKind: "Module";
  decls: SemanticDeclProjection[];
};

const tokenKinds = new Set<FrontendV2TokenKind>([
  "let",
  "keyword",
  "identifier",
  "constructor",
  "number",
  "string",
  "equals",
  "semicolon",
  "punctuation",
  "operator",
  "whitespace",
  "comment",
  "opaque",
  "eof",
]);

export async function loadFrontendV2(moduleUrl: URL | string): Promise<FrontendV2> {
  const specifier = moduleUrl instanceof URL ? moduleUrl.href : moduleUrl;
  const imported: Record<string, unknown> = await import(specifier);
  if (typeof imported.lexRoundTrip !== "function") {
    throw new Error("frontend-v2 module does not export lexRoundTrip");
  }
  if (typeof imported.parseStructural !== "function") {
    throw new Error("frontend-v2 module does not export parseStructural");
  }
  if (typeof imported.projectSemantic !== "function") {
    throw new Error("frontend-v2 module does not export projectSemantic");
  }
  const lex = imported.lexRoundTrip as (source: string) => unknown;
  const parseStructural = imported.parseStructural as (source: string) => unknown;
  const projectSemantic = imported.projectSemantic as (source: string) => unknown;
  return {
    lexRoundTrip(source: string): LexRoundTripResult {
      return validateLexResult(lex(source));
    },
    parseStructural(source: string): StructuralParseResult {
      return validateStructuralResult(parseStructural(source));
    },
    projectSemantic(source: string): SemanticProjectionResult {
      return validateSemanticProjection(projectSemantic(source));
    },
  };
}

function validateSemanticProjection(value: unknown): SemanticProjectionResult {
  if (!isObject(value)) throw new Error("frontend-v2 semantic projection must be an object");
  if (value.schemaVersion !== FRONTEND_V2_SCHEMA_VERSION) {
    throw new Error(
      `unsupported frontend-v2 schema version ${String(value.schemaVersion)}`,
    );
  }
  if (
    !isNumber(value.sourceLength) ||
    value.moduleKind !== "Module" ||
    !Array.isArray(value.decls)
  ) {
    throw new Error("frontend-v2 semantic projection has an invalid shape");
  }
  value.decls.forEach(validateSemanticDecl);
  return value as SemanticProjectionResult;
}

function validateSemanticDecl(value: unknown): void {
  validateRecord(value, "semantic declaration");
  const candidate = value as Record<string, unknown>;
  if (
    !isNumber(candidate.structuralId) ||
    typeof candidate.structuralKind !== "string" ||
    typeof candidate.semanticKind !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.recursive !== "boolean" ||
    !isNumber(candidate.start) ||
    !isNumber(candidate.end) ||
    !isNumber(candidate.recoveryId) ||
    typeof candidate.patternKind !== "string" ||
    typeof candidate.patternText !== "string" ||
    !isNumber(candidate.patternRecoveryId) ||
    typeof candidate.annotationText !== "string" ||
    typeof candidate.groupTailText !== "string" ||
    typeof candidate.expressionKind !== "string" ||
    typeof candidate.expressionText !== "string" ||
    !isNumber(candidate.expressionRecoveryId) ||
    typeof candidate.authoredExpressionHole !== "boolean"
  ) {
    throw new Error("frontend-v2 semantic declaration has an invalid shape");
  }
}

function validateStructuralResult(value: unknown): StructuralParseResult {
  if (!isObject(value)) throw new Error("frontend-v2 structural result must be an object");
  if (value.schemaVersion !== FRONTEND_V2_SCHEMA_VERSION) {
    throw new Error(
      `unsupported frontend-v2 schema version ${String(value.schemaVersion)}`,
    );
  }
  if (
    !isNumber(value.sourceLength) ||
    !isNumber(value.progressSteps) ||
    typeof value.concreteText !== "string" ||
    typeof value.virtualText !== "string" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.marks) ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.pieces)
  ) {
    throw new Error("frontend-v2 structural result has an invalid shape");
  }
  value.items.forEach(validateStructuralItem);
  value.marks.forEach((mark) => validateRecord(mark, "recovery mark"));
  value.artifacts.forEach((artifact) => validateRecord(artifact, "virtual artifact"));
  value.pieces.forEach((piece) => validateRecord(piece, "map piece"));
  return value as StructuralParseResult;
}

function validateStructuralItem(value: unknown): void {
  validateRecord(value, "structural item");
  const item = value as Record<string, unknown>;
  if (
    typeof item.expressionSurfaceKind !== "string" ||
    !Array.isArray(item.expressionNameParts) ||
    !item.expressionNameParts.every((part) => typeof part === "string") ||
    !isNumber(item.expressionRootId) ||
    !Array.isArray(item.expressionNodes) ||
    !isNumber(item.terminatorRecoveryId)
  ) {
    throw new Error("frontend-v2 structural item has an invalid Surface AST shape");
  }
  item.expressionNodes.forEach(validateSurfaceNode);
}

function validateSurfaceNode(value: unknown): void {
  validateRecord(value, "Surface AST node");
  const node = value as Record<string, unknown>;
  if (
    !isNumber(node.id) ||
    typeof node.kind !== "string" ||
    !isNumber(node.start) ||
    !isNumber(node.end) ||
    !isNumber(node.pairId) ||
    !isNumber(node.recoveryId) ||
    !Array.isArray(node.children) ||
    !node.children.every(isNumber) ||
    !Array.isArray(node.nameParts) ||
    !node.nameParts.every((part) => typeof part === "string")
  ) {
    throw new Error("frontend-v2 Surface AST node has an invalid shape");
  }
}

function validateLexResult(value: unknown): LexRoundTripResult {
  if (!isObject(value)) throw new Error("frontend-v2 lex result must be an object");
  if (value.schemaVersion !== FRONTEND_V2_SCHEMA_VERSION) {
    throw new Error(
      `unsupported frontend-v2 schema version ${String(value.schemaVersion)}`,
    );
  }
  if (!isNumber(value.sourceLength) || typeof value.rendered !== "string") {
    throw new Error("frontend-v2 lex result has invalid source metadata");
  }
  if (!Array.isArray(value.lineStarts) || !value.lineStarts.every(isNumber)) {
    throw new Error("frontend-v2 lex result has invalid line starts");
  }
  if (!Array.isArray(value.tokens)) {
    throw new Error("frontend-v2 lex result has invalid tokens");
  }
  const tokens = value.tokens.map(validateToken);
  return {
    schemaVersion: FRONTEND_V2_SCHEMA_VERSION,
    sourceLength: value.sourceLength,
    lineStarts: value.lineStarts,
    tokens,
    rendered: value.rendered,
  };
}

function validateToken(value: unknown): FrontendV2Token {
  if (
    !isObject(value) ||
    typeof value.kind !== "string" ||
    !tokenKinds.has(value.kind as FrontendV2TokenKind) ||
    typeof value.text !== "string" ||
    !isNumber(value.start) ||
    !isNumber(value.end) ||
    (value.origin !== "concrete" && value.origin !== "virtual")
  ) {
    throw new Error("frontend-v2 token has an invalid shape");
  }
  return value as FrontendV2Token;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateRecord(value: unknown, label: string): void {
  if (!isObject(value)) throw new Error(`frontend-v2 ${label} must be an object`);
}
