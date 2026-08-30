import ts from "typescript-api";
import type { GrammarAction } from "../../../scripts/frontend_v2_grammar_ir.ts";

export type PortableActionExpression =
  | Readonly<{ kind: "variable"; name: string }>
  | Readonly<{ kind: "string"; value: string }>
  | Readonly<{ kind: "boolean"; value: boolean }>
  | Readonly<{
    kind: "array";
    items: readonly Readonly<{ spread: boolean; value: PortableActionExpression }>[];
  }>
  | Readonly<{
    kind: "record";
    fields: readonly PortableActionField[];
  }>
  | Readonly<{
    kind: "member";
    target: PortableActionExpression;
    name: string;
  }>
  | Readonly<{
    kind: "call";
    callee: PortableActionExpression;
    arguments: readonly PortableActionExpression[];
  }>
  | Readonly<{
    kind: "not";
    value: PortableActionExpression;
  }>
  | Readonly<{
    kind: "binary";
    operator: "nullish" | "strict-equal";
    left: PortableActionExpression;
    right: PortableActionExpression;
  }>;

export type PortableActionField =
  | Readonly<{ kind: "property"; name: string; value: PortableActionExpression }>
  | Readonly<{ kind: "shorthand"; name: string }>
  | Readonly<{ kind: "spread"; value: PortableActionExpression }>;

export type ClassifiedAction =
  | Readonly<{
    actionId: string;
    kind: "mechanical";
    expression: PortableActionExpression;
  }>
  | Readonly<{
    actionId: string;
    kind: "named";
    wmFunction: string;
  }>;

const namedActions: Readonly<Record<string, string>> = Object.freeze({
  "Start:root.expression.elements.0": "resetParserIds",
  "TypeDeclBody:root": "classifyTypeDeclarationBody",
  "MatchFn:root": "buildMatchFunction",
  "Or:root": "foldOrExpression",
  "And:root": "foldAndExpression",
  "Equality:root": "foldEqualityExpression",
  "Compare:root": "foldCompareExpression",
  "Add:root": "foldAddExpression",
  "Mul:root": "foldMultiplyExpression",
  "Pipe:root": "foldPipeExpression",
  "Postfix:root": "foldPostfixApplication",
  "BlockSeqBody:root": "buildBlockSequence",
  "ParenSeqBody:root": "buildParenSequence",
});

export function classifyGrammarActions(
  actions: readonly GrammarAction[],
): readonly ClassifiedAction[] {
  return Object.freeze(actions.map((action) => classifyGrammarAction(action)));
}

export function classifyGrammarAction(action: GrammarAction): ClassifiedAction {
  const named = namedActions[action.id];
  if (named) {
    return Object.freeze({ actionId: action.id, kind: "named", wmFunction: named });
  }
  return Object.freeze({
    actionId: action.id,
    kind: "mechanical",
    expression: parsePortableReturnExpression(action),
  });
}

function parsePortableReturnExpression(action: GrammarAction): PortableActionExpression {
  const file = ts.createSourceFile(
    `${action.id}.ts`,
    action.code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (file.statements.length !== 1 || !ts.isReturnStatement(file.statements[0])) {
    throw new Error(`action ${action.id} is not one portable return expression`);
  }
  const expression = file.statements[0].expression;
  if (!expression) throw new Error(`action ${action.id} has no return value`);
  return normalizeExpression(expression, action.id);
}

function normalizeExpression(
  expression: ts.Expression,
  actionId: string,
): PortableActionExpression {
  if (ts.isIdentifier(expression)) {
    return Object.freeze({ kind: "variable", name: expression.text });
  }
  if (ts.isStringLiteral(expression)) {
    return Object.freeze({ kind: "string", value: expression.text });
  }
  if (
    expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return Object.freeze({
      kind: "boolean",
      value: expression.kind === ts.SyntaxKind.TrueKeyword,
    });
  }
  if (ts.isParenthesizedExpression(expression)) {
    return normalizeExpression(expression.expression, actionId);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return Object.freeze({
      kind: "array",
      items: Object.freeze(expression.elements.map((element) => {
        if (ts.isOmittedExpression(element)) {
          throw unsupported(actionId, element, "array holes");
        }
        if (ts.isSpreadElement(element)) {
          return Object.freeze({
            spread: true,
            value: normalizeExpression(element.expression, actionId),
          });
        }
        return Object.freeze({
          spread: false,
          value: normalizeExpression(element, actionId),
        });
      })),
    });
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return Object.freeze({
      kind: "record",
      fields: Object.freeze(expression.properties.map((property) => {
        if (ts.isPropertyAssignment(property)) {
          return Object.freeze({
            kind: "property" as const,
            name: propertyName(property.name, actionId),
            value: normalizeExpression(property.initializer, actionId),
          });
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          if (property.objectAssignmentInitializer) {
            throw unsupported(actionId, property, "initialized shorthand properties");
          }
          return Object.freeze({ kind: "shorthand" as const, name: property.name.text });
        }
        if (ts.isSpreadAssignment(property)) {
          return Object.freeze({
            kind: "spread" as const,
            value: normalizeExpression(property.expression, actionId),
          });
        }
        throw unsupported(actionId, property, "object member");
      })),
    });
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return Object.freeze({
      kind: "member",
      target: normalizeExpression(expression.expression, actionId),
      name: expression.name.text,
    });
  }
  if (ts.isCallExpression(expression)) {
    if (expression.typeArguments?.length) {
      throw unsupported(actionId, expression, "generic call");
    }
    return Object.freeze({
      kind: "call",
      callee: normalizeExpression(expression.expression, actionId),
      arguments: Object.freeze(
        expression.arguments.map((argument) => normalizeExpression(argument, actionId)),
      ),
    });
  }
  if (
    ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return Object.freeze({
      kind: "not",
      value: normalizeExpression(expression.operand, actionId),
    });
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ? "nullish"
      : expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      ? "strict-equal"
      : undefined;
    if (!operator) throw unsupported(actionId, expression.operatorToken, "binary operator");
    return Object.freeze({
      kind: "binary",
      operator,
      left: normalizeExpression(expression.left, actionId),
      right: normalizeExpression(expression.right, actionId),
    });
  }
  throw unsupported(actionId, expression, "expression");
}

function propertyName(name: ts.PropertyName, actionId: string): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  throw unsupported(actionId, name, "computed property name");
}

function unsupported(actionId: string, node: ts.Node, label: string): Error {
  return new Error(
    `action ${actionId} contains unsupported ${label} (${ts.SyntaxKind[node.kind]})`,
  );
}
