import type {
  GrammarExpression,
  WorkmanGrammarIr,
} from "../../../scripts/frontend_v2_grammar_ir.ts";
import type { RequiredTokenRecovery } from "./contract.ts";

export function emitCompiledProbe(
  grammar: WorkmanGrammarIr,
  grammarHash: string,
  recoveries: readonly RequiredTokenRecovery[],
): ReadonlyMap<string, string> {
  const recoveryIndex = new Set(
    recoveries.map(({ rule, token }) => recoveryKey(rule, token)),
  );
  const files = new Map<string, string>();
  files.set(
    "compiled_probe_types.wm",
    [
      header(grammar, grammarHash, ["shared character-class types"]),
      "type ClassPart = SingleCode<Number> | CodeRange<Number, Number>;",
      "",
    ].join("\n"),
  );
  const modules = partitionRules(grammar.rules, 420, recoveryIndex);
  for (const [index, rules] of modules.entries()) {
    files.set(
      moduleName(index),
      [
        header(grammar, grammarHash, rules.map((rule) => rule.name)),
        'from "../compiled_probe_runtime.wm" import { CompiledProbeMatch, matchLiteral, matchRecoverableLiteral, matchRecoverableOpeningBrace, matchCharacterClass, matchAnyCharacter, matchSequence, matchChoice, matchOptional, matchRepeated, matchOneOrMore, matchNegativeLookahead, matchText, matchLabeled, matchSyntaxAction, matchSemanticPredicate };',
        'from "./compiled_probe_types.wm" import { SingleCode, CodeRange };',
        "",
        ...rules.flatMap((rule) => [
          `let rule_${rule.name} = (source: String, offset: Number, recover: Bool, diagnose: Bool, parseRule): CompiledProbeMatch => {`,
          indent(emitRuleExpression(rule.expression, rule.name, recoveryIndex), 1),
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
    'from "../compiled_probe_runtime.wm" import { CompiledCapture, CompiledProbeMatch, CompiledProbeNoMatch, CompiledParseFailure, matchCommittedRule, commitsJsonPrimaryRecovery, wrapCompiledRule, isCompleteProbe, completedCapture, compiledFailure };',
    ...modules.map((_, index) => `from "./${moduleName(index)}" import * as Probe${index};`),
    "",
    "let rec parseStrictCompiledRule = match(name, source, offset, diagnose, ignoredRecover) => {",
    ...modules.flatMap((rules, index) =>
      rules.map((rule) => emitStrictDispatchRule(rule.name, index))
    ),
    '  (Var(name), Var(source), Var(offset), Var(diagnose), Var(ignoredRecover)) => { CompiledProbeNoMatch(offset, "known grammar rule", name) },',
    "};",
    "",
    "let rec parseRecoveringCompiledRule = match(name, source, offset, diagnose, recover) => {",
    "  (Var(name), Var(source), Var(offset), Var(diagnose), false) => {",
    "    parseStrictCompiledRule(name, source, offset, diagnose, false)",
    "  },",
    ...modules.flatMap((rules, index) =>
      rules.map((rule) => emitRecoveringDispatchRule(rule.name, index))
    ),
    '  (Var(name), Var(source), Var(offset), Var(diagnose), Var(recover)) => { CompiledProbeNoMatch(offset, "known grammar rule", name) },',
    "};",
    "",
    "let recognizeCompiled = (source: String) => {",
    '  isCompleteProbe(source, parseStrictCompiledRule("Start", source, 0, false, false))',
    "};",
    "",
    "let parseCompiledCapture = (source: String): Option<CompiledCapture> => {",
    '  completedCapture(source, parseStrictCompiledRule("Start", source, 0, false, false))',
    "};",
    "",
    "let parseRecoveringCompiledCapture = (source: String): Option<CompiledCapture> => {",
    '  completedCapture(source, parseRecoveringCompiledRule("Start", source, 0, false, true))',
    "};",
    "",
    "let parseCompiledFailure = (source: String): Option<CompiledParseFailure> => {",
    '  compiledFailure(source, parseStrictCompiledRule("Start", source, 0, true, false))',
    "};",
    "",
  ].join("\n");
}

function emitStrictDispatchRule(ruleName: string, moduleIndex: number): string {
  const call =
    `Probe${moduleIndex}.rule_${ruleName}(source, offset, false, diagnose, parseStrictCompiledRule)`;
  return `  ("${ruleName}", Var(source), Var(offset), Var(diagnose), Var(ignoredRecover)) => { wrapCompiledRule("${ruleName}", offset, ${call}) },`;
}

function emitRecoveringDispatchRule(ruleName: string, moduleIndex: number): string {
  const call = (recover: string) =>
    `Probe${moduleIndex}.rule_${ruleName}(source, offset, ${recover}, diagnose, parseRecoveringCompiledRule)`;
  let recovering = call("true");
  if (probeBeforeRecoveryRules.has(ruleName)) {
    const committed = ruleName === "Primary"
      ? "commitsJsonPrimaryRecovery(source, offset)"
      : "false";
    recovering = `if (${committed}) { ${
      call("true")
    } } else { matchCommittedRule((activeRecover) => { ${call("activeRecover")} }, true) }`;
  }
  return `  ("${ruleName}", Var(source), Var(offset), Var(diagnose), true) => { wrapCompiledRule("${ruleName}", offset, ${recovering}) },`;
}

function emitRuleExpression(
  expression: GrammarExpression,
  ruleName: string,
  recoveries: ReadonlySet<string>,
): string {
  return emitExpression(expression, ruleName, "recover", recoveries);
}

type RecoveryMode = "recover" | "true" | "false";

function emitExpression(
  expression: GrammarExpression,
  ruleName: string,
  recoveryMode: RecoveryMode,
  recoveries: ReadonlySet<string>,
): string {
  switch (expression.kind) {
    case "literal":
      if (expression.ignoreCase) {
        throw new Error("compiled probe does not support case-insensitive literals");
      }
      if (recoveries.has(recoveryKey(ruleName, expression.value))) {
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
      return `matchLiteral(${numberList(codeUnits(expression.value))}, ${
        JSON.stringify(literalExpectation(expression.value))
      }, ${JSON.stringify(ruleName)}, source, offset)`;
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
      }], ${expression.inverted ? "true" : "false"}, ${
        JSON.stringify(
          expression.inverted ? "a character outside the class" : "a character in the class",
        )
      }, ${JSON.stringify(ruleName)}, source, offset)`;
    case "any":
      return `matchAnyCharacter(${JSON.stringify(ruleName)}, source, offset)`;
    case "ruleRef":
      return `parseRule(${
        JSON.stringify(expression.name)
      }, source, offset, diagnose, ${recoveryMode})`;
    case "sequence":
      return emitParserList(
        "matchSequence",
        expression.elements,
        ruleName,
        recoveryMode,
        recoveries,
      );
    case "choice":
      if (ruleName === "BlockSeqItem" && recoveryMode !== "false") {
        return emitParserList(
          "matchChoice",
          expression.alternatives,
          ruleName,
          recoveryMode,
          recoveries,
          [recoveryMode, "false"],
        );
      }
      return emitParserList(
        "matchChoice",
        expression.alternatives,
        ruleName,
        recoveryMode,
        recoveries,
      );
    case "labeled":
      return [
        `matchLabeled(${emitOptionalString(expression.label)},`,
        indent(emitExpression(expression.expression, ruleName, recoveryMode, recoveries), 1),
        ")",
      ].join("\n");
    case "text":
      return [
        "matchText(",
        indent(emitExpression(expression.expression, ruleName, recoveryMode, recoveries), 1),
        ", offset)",
      ].join("\n");
    case "group":
      return emitExpression(expression.expression, ruleName, recoveryMode, recoveries);
    case "action":
      return [
        `matchSyntaxAction(${JSON.stringify(expression.actionId)},`,
        indent(emitExpression(expression.expression, ruleName, recoveryMode, recoveries), 1),
        ")",
      ].join("\n");
    case "simpleNot":
      return [
        "matchNegativeLookahead(",
        indent(emitExpression(expression.expression, ruleName, "false", recoveries), 1),
        ", offset)",
      ].join("\n");
    case "optional":
      return [
        "matchOptional(",
        indent(emitExpression(expression.expression, ruleName, "false", recoveries), 1),
        ", diagnose, offset)",
      ].join("\n");
    case "zeroOrMore":
      return emitUnaryParser(
        "matchRepeated",
        expression.expression,
        ruleName,
        recoveryRepetitionRules.has(ruleName) ? recoveryMode : "false",
        recoveries,
      );
    case "oneOrMore":
      return emitUnaryParser(
        "matchOneOrMore",
        expression.expression,
        ruleName,
        "false",
        recoveries,
      );
    case "semanticAnd":
      return `matchSemanticPredicate(${JSON.stringify(expression.actionId)}, ${
        JSON.stringify(ruleName)
      }, offset)`;
  }
}

function emitParserList(
  combinator: "matchSequence" | "matchChoice",
  expressions: readonly GrammarExpression[],
  ruleName: string,
  recoveryMode: RecoveryMode,
  recoveries: ReadonlySet<string>,
  recoveryModes?: readonly RecoveryMode[],
): string {
  const diagnosticArgument = combinator === "matchChoice" || combinator === "matchSequence"
    ? "diagnose, "
    : "";
  if (expressions.length === 0) {
    return `${combinator}([], ${diagnosticArgument}source, offset)`;
  }
  return [
    `${combinator}([`,
    ...expressions.flatMap((expression, index) => [
      "  (source, offset) => {",
      indent(
        emitExpression(
          expression,
          ruleName,
          recoveryModes?.[index] ?? recoveryMode,
          recoveries,
        ),
        2,
      ),
      "  },",
    ]),
    `], ${diagnosticArgument}source, offset)`,
  ].join("\n");
}

function emitUnaryParser(
  combinator: string,
  expression: GrammarExpression,
  ruleName: string,
  recoveryMode: RecoveryMode,
  recoveries: ReadonlySet<string>,
): string {
  const diagnosticArgument = combinator === "matchRepeated" ||
      combinator === "matchOneOrMore"
    ? "diagnose, "
    : "";
  return [
    `${combinator}((source, offset) => {`,
    indent(emitExpression(expression, ruleName, recoveryMode, recoveries), 1),
    `}, ${diagnosticArgument}source, offset)`,
  ].join("\n");
}

function partitionRules(
  rules: WorkmanGrammarIr["rules"],
  maximumLines: number,
  recoveries: ReadonlySet<string>,
): readonly (readonly WorkmanGrammarIr["rules"][number][])[] {
  const modules: WorkmanGrammarIr["rules"][number][][] = [];
  let current: WorkmanGrammarIr["rules"][number][] = [];
  let currentLines = 4;
  for (const rule of rules) {
    const lines = emitRuleExpression(rule.expression, rule.name, recoveries).split("\n").length + 4;
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

function recoveryKey(ruleName: string, value: string): string {
  return `${ruleName}\u0000${value}`;
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

function literalExpectation(value: string): string {
  const codes = codeUnits(value);
  return codes.some((code) => code < 32 || code === 127)
    ? `character sequence ${codes.join(",")}`
    : value;
}

function numberList(values: readonly number[]): string {
  return `[${values.join(", ")}]`;
}

function emitOptionalString(value: string | null): string {
  return value === null ? "None" : `Some(${JSON.stringify(value)})`;
}
