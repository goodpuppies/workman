import type {
  GrammarExpression,
  WorkmanGrammarIr,
} from "../../../scripts/frontend_v2_grammar_ir.ts";

export function emitCompiledProbe(
  grammar: WorkmanGrammarIr,
  grammarHash: string,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  files.set(
    "compiled_probe_types.wm",
    [
      header(grammar, grammarHash, ["shared character-class types"]),
      "type ClassPart = SingleCode<Number> | CodeRange<Number, Number>;",
      "",
    ].join("\n"),
  );
  const modules = partitionRules(grammar.rules, 420);
  for (const [index, rules] of modules.entries()) {
    files.set(
      moduleName(index),
      [
        header(grammar, grammarHash, rules.map((rule) => rule.name)),
        'from "../compiled_probe_runtime.wm" import { CompiledProbeMatch, matchLiteral, matchRecoverableLiteral, matchRecoverableOpeningBrace, matchCharacterClass, matchAnyCharacter, matchSequence, matchChoice, matchOptional, matchRepeated, matchOneOrMore, matchNegativeLookahead, matchText, matchLabeled, matchSyntaxAction, matchSemanticPredicate };',
        'from "./compiled_probe_types.wm" import { SingleCode, CodeRange };',
        "",
        ...rules.flatMap((rule) => [
          `let rule_${rule.name} = (source: String, offset: Number, recover: Bool, parseRule): CompiledProbeMatch => {`,
          indent(emitRuleExpression(rule.expression, rule.name), 1),
          "};",
          "",
        ]),
      ].join("\n"),
    );
  }
  files.set(
    "compiled_probe_dispatch.wm",
    emitDispatch(grammar, grammarHash, modules),
  );
  return files;
}

function emitDispatch(
  grammar: WorkmanGrammarIr,
  grammarHash: string,
  modules: readonly (readonly WorkmanGrammarIr["rules"][number][])[],
): string {
  return [
    header(grammar, grammarHash, grammar.rules.map((rule) => rule.name)),
    'from "../compiled_probe_runtime.wm" import { CompiledCapture, CompiledProbeMatch, CompiledProbeNoMatch, matchCommittedRule, commitsJsonPrimaryRecovery, wrapCompiledRule, isCompleteProbe, completedCapture };',
    ...modules.map((_, index) => `from "./${moduleName(index)}" import * as Probe${index};`),
    "",
    "let rec parseStrictCompiledRule = match(name, source, offset, ignoredRecover) => {",
    ...modules.flatMap((rules, index) =>
      rules.map((rule) => emitStrictDispatchRule(rule.name, index))
    ),
    "  _ => { CompiledProbeNoMatch },",
    "};",
    "",
    "let rec parseRecoveringCompiledRule = match(name, source, offset, recover) => {",
    "  (Var(name), Var(source), Var(offset), false) => {",
    "    parseStrictCompiledRule(name, source, offset, false)",
    "  },",
    ...modules.flatMap((rules, index) =>
      rules.map((rule) => emitRecoveringDispatchRule(rule.name, index))
    ),
    "  _ => { CompiledProbeNoMatch },",
    "};",
    "",
    "let recognizeCompiled = (source: String) => {",
    '  isCompleteProbe(source, parseStrictCompiledRule("Start", source, 0, false))',
    "};",
    "",
    "let parseCompiledCapture = (source: String): Option<CompiledCapture> => {",
    '  completedCapture(source, parseStrictCompiledRule("Start", source, 0, false))',
    "};",
    "",
    "let parseRecoveringCompiledCapture = (source: String): Option<CompiledCapture> => {",
    '  completedCapture(source, parseRecoveringCompiledRule("Start", source, 0, true))',
    "};",
    "",
  ].join("\n");
}

function emitStrictDispatchRule(ruleName: string, moduleIndex: number): string {
  const call =
    `Probe${moduleIndex}.rule_${ruleName}(source, offset, false, parseStrictCompiledRule)`;
  return `  ("${ruleName}", Var(source), Var(offset), Var(ignoredRecover)) => { wrapCompiledRule("${ruleName}", offset, ${call}) },`;
}

function emitRecoveringDispatchRule(ruleName: string, moduleIndex: number): string {
  const call = (recover: string) =>
    `Probe${moduleIndex}.rule_${ruleName}(source, offset, ${recover}, parseRecoveringCompiledRule)`;
  let recovering = call("true");
  if (probeBeforeRecoveryRules.has(ruleName)) {
    const committed = ruleName === "Primary"
      ? "commitsJsonPrimaryRecovery(source, offset)"
      : "false";
    recovering = `if (${committed}) { ${
      call("true")
    } } else { matchCommittedRule((activeRecover) => { ${call("activeRecover")} }, true) }`;
  }
  return `  ("${ruleName}", Var(source), Var(offset), true) => { wrapCompiledRule("${ruleName}", offset, ${recovering}) },`;
}

function emitRuleExpression(
  expression: GrammarExpression,
  ruleName: string,
): string {
  return emitExpression(expression, ruleName, "recover");
}

type RecoveryMode = "recover" | "true" | "false";

function emitExpression(
  expression: GrammarExpression,
  ruleName: string,
  recoveryMode: RecoveryMode,
): string {
  switch (expression.kind) {
    case "literal":
      if (expression.ignoreCase) {
        throw new Error("compiled probe does not support case-insensitive literals");
      }
      if (isRecoverableLiteral(ruleName, expression.value)) {
        if (expression.value === "{") {
          return `matchRecoverableOpeningBrace(${
            JSON.stringify(recoverySite(ruleName, expression.value))
          }, ${recoveryMode}, source, offset)`;
        }
        return `matchRecoverableLiteral(${numberList(codeUnits(expression.value))}, ${
          JSON.stringify(expression.value)
        }, ${
          JSON.stringify(recoverySite(ruleName, expression.value))
        }, ${recoveryMode}, source, offset)`;
      }
      return `matchLiteral(${numberList(codeUnits(expression.value))}, source, offset)`;
    case "class":
      if (expression.ignoreCase) {
        throw new Error("compiled probe does not support case-insensitive classes");
      }
      return `matchCharacterClass([${
        expression.parts.map((part) => {
          if (typeof part === "string") {
            const codes = codeUnits(part);
            if (codes.length !== 1) {
              throw new Error("compiled probe class parts must be one UTF-16 code unit");
            }
            return `SingleCode(${codes[0]})`;
          }
          const start = codeUnits(part[0]);
          const end = codeUnits(part[1]);
          if (start.length !== 1 || end.length !== 1) {
            throw new Error("compiled probe class ranges must use one UTF-16 code unit");
          }
          return `CodeRange(${start[0]}, ${end[0]})`;
        }).join(", ")
      }], ${expression.inverted ? "true" : "false"}, source, offset)`;
    case "any":
      return "matchAnyCharacter(source, offset)";
    case "ruleRef":
      return `parseRule(${JSON.stringify(expression.name)}, source, offset, ${recoveryMode})`;
    case "sequence":
      return emitParserList(
        "matchSequence",
        expression.elements,
        ruleName,
        recoveryMode,
      );
    case "choice":
      if (ruleName === "BlockSeqItem" && recoveryMode !== "false") {
        return emitParserList(
          "matchChoice",
          expression.alternatives,
          ruleName,
          recoveryMode,
          [recoveryMode, "false"],
        );
      }
      return emitParserList(
        "matchChoice",
        expression.alternatives,
        ruleName,
        recoveryMode,
      );
    case "labeled":
      return [
        `matchLabeled(${emitOptionalString(expression.label)}, (source, offset) => {`,
        indent(emitExpression(expression.expression, ruleName, recoveryMode), 1),
        "}, source, offset)",
      ].join("\n");
    case "text":
      return [
        "matchText((source, offset) => {",
        indent(emitExpression(expression.expression, ruleName, recoveryMode), 1),
        "}, source, offset)",
      ].join("\n");
    case "group":
      return emitExpression(expression.expression, ruleName, recoveryMode);
    case "action":
      return [
        `matchSyntaxAction(${JSON.stringify(expression.actionId)}, (source, offset) => {`,
        indent(emitExpression(expression.expression, ruleName, recoveryMode), 1),
        "}, source, offset)",
      ].join("\n");
    case "simpleNot":
      return emitUnaryParser(
        "matchNegativeLookahead",
        expression.expression,
        ruleName,
        "false",
      );
    case "optional":
      return emitUnaryParser(
        "matchOptional",
        expression.expression,
        ruleName,
        "false",
      );
    case "zeroOrMore":
      return emitUnaryParser(
        "matchRepeated",
        expression.expression,
        ruleName,
        recoveryRepetitionRules.has(ruleName) ? recoveryMode : "false",
      );
    case "oneOrMore":
      return emitUnaryParser(
        "matchOneOrMore",
        expression.expression,
        ruleName,
        "false",
      );
    case "semanticAnd":
      return `matchSemanticPredicate(${JSON.stringify(expression.actionId)}, offset)`;
  }
}

function emitParserList(
  combinator: "matchSequence" | "matchChoice",
  expressions: readonly GrammarExpression[],
  ruleName: string,
  recoveryMode: RecoveryMode,
  recoveryModes?: readonly RecoveryMode[],
): string {
  if (expressions.length === 0) return `${combinator}([], source, offset)`;
  return [
    `${combinator}([`,
    ...expressions.flatMap((expression, index) => [
      "  (source, offset) => {",
      indent(
        emitExpression(
          expression,
          ruleName,
          recoveryModes?.[index] ?? recoveryMode,
        ),
        2,
      ),
      "  },",
    ]),
    "], source, offset)",
  ].join("\n");
}

function emitUnaryParser(
  combinator: string,
  expression: GrammarExpression,
  ruleName: string,
  recoveryMode: RecoveryMode,
): string {
  return [
    `${combinator}((source, offset) => {`,
    indent(emitExpression(expression, ruleName, recoveryMode), 1),
    "}, source, offset)",
  ].join("\n");
}

function partitionRules(
  rules: WorkmanGrammarIr["rules"],
  maximumLines: number,
): readonly (readonly WorkmanGrammarIr["rules"][number][])[] {
  const modules: WorkmanGrammarIr["rules"][number][][] = [];
  let current: WorkmanGrammarIr["rules"][number][] = [];
  let currentLines = 4;
  for (const rule of rules) {
    const lines = emitRuleExpression(rule.expression, rule.name).split("\n").length + 4;
    if (current.length > 0 && currentLines + lines > maximumLines) {
      modules.push(current);
      current = [];
      currentLines = 4;
    }
    current.push(rule);
    currentLines += lines;
  }
  if (current.length > 0) modules.push(current);
  return modules;
}

const recoverableBraceRules = new Set([
  "ImportClause",
  "JsImportClauseBody",
  "RecordDecl",
  "MatchExpr",
  "MatchFn",
  "LambdaBlock",
  "JsonExpr",
  "RecordExpr",
  "Block",
  "RecordPattern",
  "RecordLetPattern",
  "RecordParamPattern",
]);

const probeBeforeRecoveryRules = new Set([
  "Start",
  "LambdaBody",
  "JsonExpr",
  "Primary",
]);

const recoveryRepetitionRules = new Set([
  "Start",
  "LambdaBlock",
  "BlockSeqBody",
]);

function isRecoverableLiteral(ruleName: string, value: string): boolean {
  if (value === ";") {
    return ruleName === "TopPhrase" || ruleName === "SemiToken";
  }
  return (value === "{" || value === "}") &&
    recoverableBraceRules.has(ruleName);
}

function recoverySite(ruleName: string, value: string): string {
  if (value === ";") return `${ruleName}:semicolon`;
  return `${ruleName}:${value === "{" ? "open-brace" : "close-brace"}`;
}

function moduleName(index: number): string {
  return `compiled_probe_rules_${String(index).padStart(2, "0")}.wm`;
}

function header(grammar: WorkmanGrammarIr, hash: string, rules: readonly string[]): string {
  return [
    "-- Generated by scripts/generate_frontend_v2_recognizer.ts. Do not edit.",
    `-- Grammar: ${grammar.sourcePath}`,
    `-- Grammar IR SHA-256: ${hash}`,
    `-- Directly compiled rules: ${rules.join(", ")}`,
  ].join("\n");
}

function indent(value: string, depth: number): string {
  const prefix = "  ".repeat(depth);
  return value.split("\n").map((line) => prefix + line).join("\n");
}

function codeUnits(value: string): number[] {
  return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
}

function numberList(values: readonly number[]): string {
  return `[${values.join(", ")}]`;
}

function emitOptionalString(value: string | null): string {
  return value === null ? "None" : `Some(${JSON.stringify(value)})`;
}
