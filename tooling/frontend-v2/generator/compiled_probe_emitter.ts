import type {
  GrammarExpression,
  WorkmanGrammarIr,
} from "../../../scripts/frontend_v2_grammar_ir.ts";
import type { RequiredTokenRecovery } from "./contract.ts";
import { emitFirstCheck, FirstSets, isGuardable } from "./first_sets.ts";
import { Scanners } from "./scanners.ts";
import { surfaceRuleGroups } from "./surface_schema.ts";

/** FIRST sets of the grammar being emitted; set by `emitCompiledProbe`. */
let firstSets: FirstSets | undefined;

/** Lexical scanners of the grammar being emitted; set by `emitCompiledProbe`. */
let scanners: Scanners | undefined;

/**
 * Constant lists of the rules module being emitted, by WM source text. A list literal in a rule
 * body would build its cons cells on every call; a module-level `let` builds them once.
 */
let moduleConstants: Map<string, string> | undefined;

function constant(prefix: string, value: string): string {
  if (!moduleConstants) return value;
  let name = moduleConstants.get(value);
  if (!name) {
    name = `${prefix}_${moduleConstants.size}`;
    moduleConstants.set(value, name);
  }
  return name;
}

export function emitCompiledProbe(
  grammar: WorkmanGrammarIr,
  grammarHash: string,
  recoveries: readonly RequiredTokenRecovery[],
): ReadonlyMap<string, string> {
  const recoveryIndex = new Set(
    recoveries.map(({ rule, token }) => recoveryKey(rule, token)),
  );
  firstSets = new FirstSets(grammar, {
    isRecoverableLiteral: (rule, value) => recoveryIndex.has(recoveryKey(rule, value)),
    recoveryRepetitionRules,
  });
  scanners = new Scanners(
    grammar,
    new Set(surfaceRuleGroups.trivia),
    new Set(surfaceRuleGroups.token),
    (rule, value) => recoveryIndex.has(recoveryKey(rule, value)),
    (codes) => constant("literal", codes),
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
  files.set("compiled_probe_rules.wm", emitRules(grammar, grammarHash, recoveryIndex));
  files.set("compiled_probe_dispatch.wm", emitDispatch(grammar, grammarHash));
  return files;
}

/**
 * Every rule in one module, as one recursive group, so a rule reference is a direct call: rules
 * split across modules could only reach each other through a rule-name lookup passed in as a
 * function, which cost a table lookup and an argument tuple per call.
 *
 * `rule_X` parses rule X in one recovery mode. `enter_X` is what a reference to X calls: it looks
 * the result up in the parse's memo, otherwise runs the strict or recovering entry and wraps the
 * capture, exactly as the former name-keyed dispatcher did.
 */
function emitRules(
  grammar: WorkmanGrammarIr,
  grammarHash: string,
  recoveryIndex: ReadonlySet<string>,
): string {
  moduleConstants = new Map();
  const ruleCount = grammar.rules.length;
  const group = grammar.rules.flatMap((rule, index) => [
    `${index === 0 ? "let rec" : "and"} rule_${rule.name} = (source: String, offset: Number, recover: Bool, diagnose: Bool, parser: CompiledParser): CompiledProbeMatch => {`,
    indent(emitGuardedRule(rule.name, emitRuleExpression(rule.expression, rule.name, recoveryIndex)), 1),
    "}",
    ...emitRuleEntry(rule.name, index),
  ]);
  const byName = [
    "and parseRuleByName = (parser: CompiledParser, name: String, source: String, offset: Number, diagnose: Bool, recover: Bool): CompiledProbeMatch => {",
    "  match(name) {",
    ...grammar.rules.map((rule) =>
      `    ${JSON.stringify(rule.name)} => { enter_${rule.name}(parser, source, offset, diagnose, recover) },`
    ),
    '    _ => { CompiledProbeNoMatch(offset, "known grammar rule", name) },',
    "  }",
    "};",
  ];
  const scanFunctions = scanners!.functions();
  const constants = [...moduleConstants].map(([value, name]) => `let ${name} = ${value};`);
  moduleConstants = undefined;
  return [
    header(grammar, grammarHash, grammar.rules.map((rule) => rule.name)),
    'from "../compiled_probe_runtime.wm" import { CompiledProbeMatch, CompiledProbeMatched, CompiledProbeNoMatch, EmptyCompiledCapture, TokenCompiledCapture, RuleCompiledCapture, SequenceCompiledCapture, ChoiceCompiledCapture, bestFailure, failureWithBest, trackedFailure, unobservedFailure, codeAt, literalEnd, matchLiteral, matchRecoverableLiteral, matchRecoverableOpeningBrace, matchCharacterClass, matchAnyCharacter, matchSequence, matchChoice, matchOptional, matchRepeated, matchOneOrMore, matchNegativeLookahead, matchText, matchSemanticPredicate, matchNamedMatchArms, matchCommittedRule, commitsJsonPrimaryRecovery, commitsLambdaPrimaryRecovery, wrapCompiledRule };',
    'from "./compiled_probe_types.wm" import { SingleCode, CodeRange };',
    'from js.host("table") import * as Table;',
    "",
    "-- The state of one parse: memoized rule results, keyed by `compiledRuleSlot`.",
    "record CompiledParser = { memo: Js.Table<CompiledProbeMatch> };",
    "",
    "let newCompiledParser = () => {",
    "  let parser: CompiledParser = .{ memo = Table.empty() };",
    "  parser",
    "};",
    "",
    "-- One number per rule, offset and mode: a single table lookup per rule call.",
    "let compiledRuleSlot = (rule: Number, offset: Number, diagnose: Bool, recover: Bool) => {",
    `  (offset * 4 + (if (diagnose) { 2 } else { 0 }) + (if (recover) { 1 } else { 0 })) * ${ruleCount} + rule`,
    "};",
    "",
    ...constants,
    "",
    ...group,
    ...lambdaGuardFunctions,
    ...scanFunctions,
    ...byName,
    "",
  ].join("\n");
}

/**
 * Most expressions start with an identifier, and `x` alone is a lambda parameter, so `Lambda` would
 * parse a whole parameter before finding no arrow. The check runs only when not diagnosing, so
 * reported failures still list what a lambda expected.
 */
function emitGuardedRule(name: string, body: string): string {
  if (name !== "Lambda") return body;
  return ["if (diagnose || lambdaCanStart(source, offset)) {", indent(body, 1), "} else { unobservedFailure }"]
    .join("\n");
}

const lambdaGuardFunctions = [
  "and identifierPartsEnd = (source: String, offset: Number): Number => {",
  "  let code = codeAt(source, offset);",
  "  if ((code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code == 95 || code == 39) {",
  "    identifierPartsEnd(source, offset + 1)",
  "  } else { offset }",
  "}",
  "and lambdaCanStart = (source: String, offset: Number): Bool => {",
  "  let first = codeAt(source, offset);",
  "  if ((first >= 97 && first <= 122) || first == 95) {",
  "    let after = scan__(source, identifierPartsEnd(source, offset + 1));",
  "    let code = codeAt(source, after);",
  "    code == 58 || code == 124 || (code == 61 && codeAt(source, after + 1) == 62)",
  "  } else { true }",
  "}",
];

/** What a reference to a rule calls: its scanner when possible, otherwise the memoized parse. */
function emitRuleEntry(name: string, index: number): string[] {
  const memoized = [
    `let slot = compiledRuleSlot(${index}, offset, diagnose, recover);`,
    "match(Table.getAt(parser.memo, slot)) {",
    "  Some(cached) => { cached },",
    "  None => {",
    `    let result = wrapCompiledRule(${JSON.stringify(name)}, offset, diagnose, if (recover) {`,
    indent(emitRecoveringEntry(name), 3),
    "    } else {",
    `      rule_${name}(source, offset, false, diagnose, parser)`,
    "    });",
    "    Table.setAt(parser.memo, slot, result);",
    "    result",
    "  },",
    "}",
  ].join("\n");
  const signature =
    `and enter_${name} = (parser: CompiledParser, source: String, offset: Number, diagnose: Bool, recover: Bool): CompiledProbeMatch => {`;
  if (!scanners!.scansWholeRule(name)) return [signature, indent(memoized, 1), "}"];
  const inner = surfaceRuleGroups.trivia.includes(name)
    ? "EmptyCompiledCapture"
    : 'TokenCompiledCapture("text", offset, next)';
  return [
    signature,
    "  if (diagnose) {",
    indent(memoized, 2),
    "  } else {",
    `    let next = ${scanners!.ruleCall(name)};`,
    `    if (next >= 0) { CompiledProbeMatched(next, RuleCompiledCapture(${JSON.stringify(name)}, ${inner}, offset, next), None) } else { unobservedFailure }`,
    "  }",
    "}",
  ];
}

function emitDispatch(grammar: WorkmanGrammarIr, grammarHash: string): string {
  return [
    header(grammar, grammarHash, grammar.rules.map((rule) => rule.name)),
    'from "../compiled_probe_runtime.wm" import { CompiledCapture, CompiledParseFailure, isCompleteProbe, completedCapture, compiledFailure };',
    'from "./compiled_probe_rules.wm" import { enter_Start, newCompiledParser };',
    "",
    "let recognizeCompiled = (source: String) => {",
    "  isCompleteProbe(source, enter_Start(newCompiledParser(), source, 0, false, false))",
    "};",
    "",
    "let parseCompiledCapture = (source: String): Option<CompiledCapture> => {",
    "  completedCapture(source, enter_Start(newCompiledParser(), source, 0, false, false))",
    "};",
    "",
    "let parseRecoveringCompiledCapture = (source: String): Option<CompiledCapture> => {",
    "  completedCapture(source, enter_Start(newCompiledParser(), source, 0, false, true))",
    "};",
    "",
    "let parseCompiledFailure = (source: String): Option<CompiledParseFailure> => {",
    "  compiledFailure(source, enter_Start(newCompiledParser(), source, 0, true, false))",
    "};",
    "",
  ].join("\n");
}

/** A runtime helper that looks rules up by name, bound to this parse. */
const parseRuleCallback =
  "(name, source, offset, diagnose, recover) => { parseRuleByName(parser, name, source, offset, diagnose, recover) }";

/** How rule X runs with recovery active; mirrors the former recovering dispatch table. */
function emitRecoveringEntry(ruleName: string): string {
  const call = (recover: string) => `rule_${ruleName}(source, offset, ${recover}, diagnose, parser)`;
  if (!probeBeforeRecoveryRules.has(ruleName)) return call("true");
  const committed = ruleName === "Primary"
    ? `commitsJsonPrimaryRecovery(source, offset) || commitsLambdaPrimaryRecovery(source, offset, ${parseRuleCallback})`
    : "false";
  return `if (${committed}) { ${call("true")} } else { matchCommittedRule((activeRecover) => { ${
    call("activeRecover")
  } }, true) }`;
}

function emitRuleExpression(
  expression: GrammarExpression,
  ruleName: string,
  recoveries: ReadonlySet<string>,
): string {
  inlineNames = 0;
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
          }, ${recoveryMode}, diagnose, source, offset)`;
        }
        return `matchRecoverableLiteral(${constant("literal", numberList(codeUnits(expression.value)))}, ${
          JSON.stringify(expression.value)
        }, ${
          JSON.stringify(recoverySite(ruleName, expression.value))
        }, ${recoveryMode}, diagnose, source, offset)`;
      }
      return `matchLiteral(${constant("literal", numberList(codeUnits(expression.value)))}, ${
        JSON.stringify(literalExpectation(expression.value))
      }, ${JSON.stringify(ruleName)}, diagnose, source, offset)`;
    case "class":
      if (expression.ignoreCase) {
        throw new Error("compiled probe does not support case-insensitive classes");
      }
      return `matchCharacterClass(${constant("characters", `[${
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
      }]`)}, ${expression.inverted ? "true" : "false"}, ${
        JSON.stringify(
          expression.inverted ? "a character outside the class" : "a character in the class",
        )
      }, ${JSON.stringify(ruleName)}, diagnose, source, offset)`;
    case "any":
      return `matchAnyCharacter(${JSON.stringify(ruleName)}, diagnose, source, offset)`;
    case "ruleRef":
      return `enter_${expression.name}(parser, source, offset, diagnose, ${recoveryMode})`;
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
    case "labeled": {
      const labeled = emitExpression(expression.expression, ruleName, recoveryMode, recoveries);
      // This slot is reached only after the named parameter list and its arrow
      // have matched. Keep the diagnostic tied to that grammar decision.
      return ruleName === "MatchFn" && expression.label === "arms"
        ? `matchNamedMatchArms(source, offset,\n${indent(labeled, 1)}\n, ${parseRuleCallback})`
        : labeled;
    }
    case "text": {
      const text = [
        "matchText(",
        indent(emitExpression(expression.expression, ruleName, recoveryMode, recoveries), 1),
        ", offset)",
      ].join("\n");
      if (!scanners!.canScan(expression.expression, ruleName)) return text;
      const end = inlineName("end");
      return [
        "if (diagnose) {",
        indent(text, 1),
        "} else {",
        `  let ${end} = ${scanners!.emit(expression.expression)};`,
        `  if (${end} >= 0) { CompiledProbeMatched(${end}, TokenCompiledCapture("text", offset, ${end}), None) } else { unobservedFailure }`,
        "}",
      ].join("\n");
    }
    case "group":
      return emitExpression(expression.expression, ruleName, recoveryMode, recoveries);
    case "action":
      return emitExpression(expression.expression, ruleName, recoveryMode, recoveries);
    case "simpleNot": {
      const lookahead = [
        "matchNegativeLookahead(",
        indent(emitExpression(expression.expression, ruleName, "false", recoveries), 1),
        ", offset)",
      ].join("\n");
      if (!scanners!.canScan(expression.expression, ruleName)) return lookahead;
      return [
        "if (diagnose) {",
        indent(lookahead, 1),
        "} else {",
        `  if (${scanners!.emit(expression.expression)} >= 0) { unobservedFailure } else { CompiledProbeMatched(offset, EmptyCompiledCapture, None) }`,
        "}",
      ].join("\n");
    }
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
  const bodies = expressions.map((expression, index) =>
    emitExpression(expression, ruleName, recoveryModes?.[index] ?? recoveryMode, recoveries)
  );
  if (combinator === "matchSequence") return emitInlineSequence(bodies);
  const guards = expressions.map((expression, index) =>
    firstGuard(expression, ruleName, recoveryModes?.[index] ?? recoveryMode)
  );
  const alternatives = bodies.map((body, index) =>
    guards[index] === undefined
      ? body
      : [`if (diagnose || ${guards[index]}) {`, indent(body, 1), "} else { unobservedFailure }"]
        .join("\n")
  );
  const choice = emitInlineChoice(alternatives);
  if (!guards.some((guard) => guard !== undefined)) return choice;
  return ["{", "  let firstCode = codeAt(source, offset);", indent(choice, 1), "}"].join("\n");
}

/** Names for the locals of inline sequences and choices, unique within one rule body. */
let inlineNames = 0;

function inlineName(prefix: string): string {
  return `${prefix}${inlineNames++}`;
}

/**
 * A sequence written out element by element, as `matchSequenceInto` would run it: each element
 * starts where the previous one ended, the best failure seen so far is carried while
 * diagnosing, and the first failing element ends the sequence. No parser list is built.
 */
function emitInlineSequence(elements: readonly string[]): string {
  const step = (index: number, at: string, best: string, captures: readonly string[]): string => {
    if (index === elements.length) {
      return `CompiledProbeMatched(${at}, SequenceCompiledCapture([${captures.join(", ")}]), ${best})`;
    }
    const element = index === 0
      ? elements[index]
      : [`{`, `  let offset = ${at};`, indent(elements[index], 1), `}`].join("\n");
    const [next, capture, latent, nextBest] = ["next", "capture", "latent", "best"].map(inlineName);
    const [failedAt, expected, rule] = ["failedAt", "expected", "rule"].map(inlineName);
    return [
      "match(",
      indent(element, 1),
      ") {",
      `  CompiledProbeMatched(${next}, ${capture}, ${latent}) => {`,
      `    let ${nextBest} = if (diagnose) { bestFailure(${best}, ${latent}) } else { None };`,
      indent(step(index + 1, next, nextBest, [...captures, capture]), 2),
      "  },",
      `  CompiledProbeNoMatch(${failedAt}, ${expected}, ${rule}) => {`,
      `    if (diagnose) { failureWithBest(${best}, ${failedAt}, ${expected}, ${rule}) } else { unobservedFailure }`,
      "  },",
      "}",
    ].join("\n");
  };
  return step(0, "offset", "None", []);
}

/**
 * A choice written out alternative by alternative, as `matchChoiceAt` would run it: the first
 * match wins, and each failure is folded into the best failure while diagnosing.
 */
function emitInlineChoice(alternatives: readonly string[]): string {
  const step = (index: number, best: string): string => {
    if (index === alternatives.length) {
      return `if (diagnose) { failureWithBest(${best}, offset, "valid syntax", "<choice>") } else { unobservedFailure }`;
    }
    const [next, capture, latent, nextBest] = ["next", "capture", "latent", "best"].map(inlineName);
    const [failedAt, expected, rule] = ["failedAt", "expected", "rule"].map(inlineName);
    return [
      "match(",
      indent(alternatives[index], 1),
      ") {",
      `  CompiledProbeMatched(${next}, ${capture}, ${latent}) => {`,
      `    CompiledProbeMatched(${next}, ChoiceCompiledCapture(${index}, ${capture}), if (diagnose) { bestFailure(${best}, ${latent}) } else { None })`,
      "  },",
      `  CompiledProbeNoMatch(${failedAt}, ${expected}, ${rule}) => {`,
      `    let ${nextBest} = if (diagnose) { bestFailure(${best}, trackedFailure(diagnose, ${failedAt}, ${expected}, ${rule})) } else { None };`,
      indent(step(index + 1, nextBest), 2),
      "  },",
      "}",
    ].join("\n");
  };
  return step(0, "None");
}

/**
 * The condition under which a choice alternative can match at all, from the code unit at the
 * choice's offset; undefined when it can't be decided that way. Only consulted without
 * diagnostics: a choice that is not diagnosing discards its alternatives' failures, so skipping
 * one that would fail leaves the result unchanged. Diagnosing runs every alternative as before.
 */
function firstGuard(
  expression: GrammarExpression,
  ruleName: string,
  recoveryMode: RecoveryMode,
): string | undefined {
  const sets = firstSets!;
  const strict = sets.of(expression, ruleName, false);
  const recovering = sets.of(expression, ruleName, true);
  const check = (first: typeof strict) =>
    isGuardable(first) ? `(${emitFirstCheck(first, "firstCode")})` : undefined;
  if (recoveryMode === "false") return check(strict);
  if (recoveryMode === "true") return check(recovering);
  const strictCheck = check(strict);
  const recoveringCheck = check(recovering);
  if (strictCheck === undefined) return undefined;
  if (recoveringCheck === undefined) return `(recover || ${strictCheck})`;
  return recoveringCheck === strictCheck
    ? strictCheck
    : `(if (recover) { ${recoveringCheck} } else { ${strictCheck} })`;
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

const probeBeforeRecoveryRules = new Set([
  "Start",
  "LambdaBody",
  "BareLambdaBody",
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
