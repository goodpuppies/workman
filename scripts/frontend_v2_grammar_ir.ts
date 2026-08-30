import peggy from "peggy";

export const FRONTEND_V2_GRAMMAR_IR_VERSION = 1;

export type SourcePoint = Readonly<{
  offset: number;
  line: number;
  column: number;
}>;

export type SourceRange = Readonly<{
  start: SourcePoint;
  end: SourcePoint;
}>;

export type ActionClassification =
  | Readonly<{ kind: "mechanical"; template: string }>
  | Readonly<{ kind: "named"; functionName: string }>
  | Readonly<{ kind: "unclassified" }>;

export type GrammarAction = Readonly<{
  id: string;
  rule: string;
  code: string;
  location: SourceRange;
  classification: ActionClassification;
}>;

export type GrammarExpression =
  | Readonly<{ kind: "literal"; value: string; ignoreCase: boolean; location: SourceRange }>
  | Readonly<{
    kind: "class";
    parts: readonly (string | readonly [string, string])[];
    inverted: boolean;
    ignoreCase: boolean;
    location: SourceRange;
  }>
  | Readonly<{ kind: "any"; location: SourceRange }>
  | Readonly<{ kind: "ruleRef"; name: string; location: SourceRange }>
  | Readonly<{
    kind: "sequence";
    elements: readonly GrammarExpression[];
    location: SourceRange;
  }>
  | Readonly<{
    kind: "choice";
    alternatives: readonly GrammarExpression[];
    location: SourceRange;
  }>
  | Readonly<{
    kind: "labeled";
    label: string | null;
    expression: GrammarExpression;
    location: SourceRange;
  }>
  | Readonly<{ kind: "text"; expression: GrammarExpression; location: SourceRange }>
  | Readonly<{ kind: "simpleNot"; expression: GrammarExpression; location: SourceRange }>
  | Readonly<{ kind: "optional"; expression: GrammarExpression; location: SourceRange }>
  | Readonly<{ kind: "zeroOrMore"; expression: GrammarExpression; location: SourceRange }>
  | Readonly<{ kind: "oneOrMore"; expression: GrammarExpression; location: SourceRange }>
  | Readonly<{ kind: "group"; expression: GrammarExpression; location: SourceRange }>
  | Readonly<{ kind: "semanticAnd"; actionId: string; location: SourceRange }>
  | Readonly<{
    kind: "action";
    expression: GrammarExpression;
    actionId: string;
    location: SourceRange;
  }>;

export type GrammarRule = Readonly<{
  name: string;
  location: SourceRange;
  expression: GrammarExpression;
}>;

export type WorkmanGrammarIr = Readonly<{
  schemaVersion: number;
  sourcePath: string;
  initializer: Readonly<{ code: string; location: SourceRange }> | null;
  rules: readonly GrammarRule[];
  actions: readonly GrammarAction[];
}>;

export type GrammarInventory = Readonly<{
  schemaVersion: number;
  ruleCount: number;
  expressionKinds: Readonly<Record<string, number>>;
  actionClassifications: Readonly<Record<ActionClassification["kind"], number>>;
  unresolvedRuleReferences: readonly string[];
}>;

type ObjectValue = Record<string, unknown>;

export function parseWorkmanGrammar(source: string, sourcePath: string): WorkmanGrammarIr {
  const grammar = object(peggy.generate(source, { output: "ast" }), "grammar");
  if (grammar.type !== "grammar") throw new Error("Peggy did not return a grammar AST");

  const actions: GrammarAction[] = [];
  const rules = array(grammar.rules, "grammar.rules").map((value) => {
    const rule = object(value, "grammar rule");
    if (rule.type !== "rule") throw new Error(`expected rule node, got ${String(rule.type)}`);
    const name = string(rule.name, "rule.name");
    return Object.freeze({
      name,
      location: range(rule.location, `rule ${name}`),
      expression: normalizeExpression(
        object(rule.expression, `rule ${name} expression`),
        name,
        "root",
        actions,
      ),
    });
  });

  const initializer = grammar.initializer === null || grammar.initializer === undefined
    ? null
    : (() => {
      const node = object(grammar.initializer, "grammar initializer");
      return Object.freeze({
        code: string(node.code, "initializer.code"),
        location: range(node.location, "initializer"),
      });
    })();

  return Object.freeze({
    schemaVersion: FRONTEND_V2_GRAMMAR_IR_VERSION,
    sourcePath,
    initializer,
    rules: Object.freeze(rules),
    actions: Object.freeze(actions),
  });
}

export function inventoryGrammar(ir: WorkmanGrammarIr): GrammarInventory {
  const expressionKinds: Record<string, number> = {};
  const visit = (expression: GrammarExpression): void => {
    expressionKinds[expression.kind] = (expressionKinds[expression.kind] ?? 0) + 1;
    switch (expression.kind) {
      case "sequence":
        expression.elements.forEach(visit);
        break;
      case "choice":
        expression.alternatives.forEach(visit);
        break;
      case "labeled":
      case "text":
      case "simpleNot":
      case "optional":
      case "zeroOrMore":
      case "oneOrMore":
      case "group":
      case "action":
        visit(expression.expression);
        break;
    }
  };
  ir.rules.forEach((rule) => visit(rule.expression));

  const ruleNames = new Set(ir.rules.map((rule) => rule.name));
  const references = new Set<string>();
  const collectReferences = (expression: GrammarExpression): void => {
    if (expression.kind === "ruleRef") references.add(expression.name);
    switch (expression.kind) {
      case "sequence":
        expression.elements.forEach(collectReferences);
        break;
      case "choice":
        expression.alternatives.forEach(collectReferences);
        break;
      case "labeled":
      case "text":
      case "simpleNot":
      case "optional":
      case "zeroOrMore":
      case "oneOrMore":
      case "group":
      case "action":
        collectReferences(expression.expression);
        break;
    }
  };
  ir.rules.forEach((rule) => collectReferences(rule.expression));

  const actionClassifications = { mechanical: 0, named: 0, unclassified: 0 };
  for (const action of ir.actions) actionClassifications[action.classification.kind] += 1;

  return Object.freeze({
    schemaVersion: FRONTEND_V2_GRAMMAR_IR_VERSION,
    ruleCount: ir.rules.length,
    expressionKinds: Object.freeze(sortedRecord(expressionKinds)),
    actionClassifications: Object.freeze(actionClassifications),
    unresolvedRuleReferences: Object.freeze(
      [...references].filter((name) => !ruleNames.has(name)).sort(),
    ),
  });
}

export async function hashGrammarIr(ir: WorkmanGrammarIr): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(ir)),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeExpression(
  node: ObjectValue,
  rule: string,
  path: string,
  actions: GrammarAction[],
): GrammarExpression {
  const location = range(node.location, `${rule}:${path}`);
  const child = (key = "expression") =>
    normalizeExpression(
      object(node[key], `${rule}:${path}.${key}`),
      rule,
      `${path}.${key}`,
      actions,
    );

  switch (node.type) {
    case "literal":
      return Object.freeze({
        kind: "literal",
        value: string(node.value, `${rule}:${path}.value`),
        ignoreCase: boolean(node.ignoreCase, `${rule}:${path}.ignoreCase`),
        location,
      });
    case "class":
      return Object.freeze({
        kind: "class",
        parts: Object.freeze(
          array(node.parts, `${rule}:${path}.parts`).map((part) => normalizeClassPart(part)),
        ),
        inverted: boolean(node.inverted, `${rule}:${path}.inverted`),
        ignoreCase: boolean(node.ignoreCase, `${rule}:${path}.ignoreCase`),
        location,
      });
    case "any":
      return Object.freeze({ kind: "any", location });
    case "rule_ref":
      return Object.freeze({
        kind: "ruleRef",
        name: string(node.name, `${rule}:${path}.name`),
        location,
      });
    case "sequence":
      return Object.freeze({
        kind: "sequence",
        elements: Object.freeze(
          array(node.elements, `${rule}:${path}.elements`).map((item, index) =>
            normalizeExpression(
              object(item, `${rule}:${path}.elements[${index}]`),
              rule,
              `${path}.elements.${index}`,
              actions,
            )
          ),
        ),
        location,
      });
    case "choice":
      return Object.freeze({
        kind: "choice",
        alternatives: Object.freeze(
          array(node.alternatives, `${rule}:${path}.alternatives`).map((item, index) =>
            normalizeExpression(
              object(item, `${rule}:${path}.alternatives[${index}]`),
              rule,
              `${path}.alternatives.${index}`,
              actions,
            )
          ),
        ),
        location,
      });
    case "labeled":
      return Object.freeze({
        kind: "labeled",
        label: node.label === null ? null : string(node.label, `${rule}:${path}.label`),
        expression: child(),
        location,
      });
    case "text":
      return Object.freeze({ kind: "text", expression: child(), location });
    case "simple_not":
      return Object.freeze({ kind: "simpleNot", expression: child(), location });
    case "optional":
      return Object.freeze({ kind: "optional", expression: child(), location });
    case "zero_or_more":
      return Object.freeze({ kind: "zeroOrMore", expression: child(), location });
    case "one_or_more":
      return Object.freeze({ kind: "oneOrMore", expression: child(), location });
    case "group":
      return Object.freeze({ kind: "group", expression: child(), location });
    case "semantic_and": {
      const actionId = addAction(node, rule, path, actions);
      return Object.freeze({ kind: "semanticAnd", actionId, location });
    }
    case "action": {
      const expression = child();
      const actionId = addAction(node, rule, path, actions);
      return Object.freeze({ kind: "action", expression, actionId, location });
    }
    default:
      throw new Error(`unsupported Peggy node ${String(node.type)} at ${rule}:${path}`);
  }
}

function addAction(
  node: ObjectValue,
  rule: string,
  path: string,
  actions: GrammarAction[],
): string {
  const id = `${rule}:${path}`;
  actions.push(Object.freeze({
    id,
    rule,
    code: string(node.code, `${id}.code`),
    location: range(node.codeLocation ?? node.location, id),
    classification: Object.freeze({ kind: "unclassified" }),
  }));
  return id;
}

function normalizeClassPart(value: unknown): string | readonly [string, string] {
  if (typeof value === "string") return value;
  const pair = array(value, "character class range");
  if (pair.length !== 2) throw new Error("character class range must have two endpoints");
  const normalized: readonly [string, string] = [
    string(pair[0], "character class range start"),
    string(pair[1], "character class range end"),
  ];
  return Object.freeze(normalized);
}

function range(value: unknown, label: string): SourceRange {
  const sourceRange = object(value, `${label}.location`);
  return Object.freeze({
    start: point(sourceRange.start, `${label}.start`),
    end: point(sourceRange.end, `${label}.end`),
  });
}

function point(value: unknown, label: string): SourcePoint {
  const sourcePoint = object(value, label);
  return Object.freeze({
    offset: number(sourcePoint.offset, `${label}.offset`),
    line: number(sourcePoint.line, `${label}.line`),
    column: number(sourcePoint.column, `${label}.column`),
  });
}

function object(value: unknown, label: string): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as ObjectValue;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function sortedRecord(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

if (import.meta.main) {
  const grammarPath = Deno.args[0] ?? "src/grammar.peggy";
  const source = await Deno.readTextFile(grammarPath);
  console.log(JSON.stringify(inventoryGrammar(parseWorkmanGrammar(source, grammarPath)), null, 2));
}
