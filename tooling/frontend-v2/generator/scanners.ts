import type {
  GrammarExpression,
  WorkmanGrammarIr,
} from "../../../scripts/frontend_v2_grammar_ir.ts";

/**
 * Allocation-free matching for lexical syntax.
 *
 * A scanner is a WM function from an offset to the offset where the expression ends, or -1. It
 * builds no captures and needs no memo entry, so it replaces the ordinary code wherever the parser
 * throws the captures away and is not diagnosing: inside `$(...)` and `!x`, and for whole trivia
 * and token rules, whose contents Surface construction ignores.
 *
 * Only rules in the trivia and token groups are scanned. They are regular apart from nested block
 * comments, so running them without a memo can't backtrack badly, which syntactic rules could.
 */
export class Scanners {
  readonly #rules: ReadonlyMap<string, GrammarExpression>;
  readonly #lexical: ReadonlySet<string>;
  readonly #wholeRules: ReadonlySet<string>;
  readonly #isRecoverable: (ruleName: string, value: string) => boolean;
  readonly #literalConstant: (codes: string) => string;
  readonly #requested = new Set<string>();
  readonly #pending: string[] = [];
  readonly #functions: string[] = [];
  #names = 0;

  constructor(
    grammar: WorkmanGrammarIr,
    trivia: ReadonlySet<string>,
    tokens: ReadonlySet<string>,
    isRecoverable: (ruleName: string, value: string) => boolean,
    literalConstant: (codes: string) => string,
  ) {
    this.#literalConstant = literalConstant;
    this.#rules = new Map(grammar.rules.map((rule) => [rule.name, rule.expression]));
    this.#isRecoverable = isRecoverable;
    this.#lexical = this.#closedSubset(new Set([...trivia, ...tokens]));
    this.#wholeRules = new Set(
      [...this.#lexical].filter((name) =>
        trivia.has(name) || !this.#reachesAny(name, trivia, new Set())
      ),
    );
  }

  /** The rules in `candidates` that can be scanned using only each other. */
  #closedSubset(candidates: Set<string>): ReadonlySet<string> {
    const closed = new Set(candidates);
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of closed) {
        const expression = this.#rules.get(name);
        if (!expression || !this.#canScan(expression, name, closed)) {
          closed.delete(name);
          changed = true;
        }
      }
    }
    return closed;
  }

  #canScan(
    expression: GrammarExpression,
    ruleName: string,
    rules: ReadonlySet<string>,
  ): boolean {
    switch (expression.kind) {
      case "literal":
        return !expression.ignoreCase && !this.#isRecoverable(ruleName, expression.value);
      case "class":
        return !expression.ignoreCase;
      case "any":
        return true;
      case "ruleRef":
        return rules.has(expression.name);
      case "sequence":
        return expression.elements.every((element) => this.#canScan(element, ruleName, rules));
      case "choice":
        return expression.alternatives.every((option) => this.#canScan(option, ruleName, rules));
      case "semanticAnd":
        return false;
      default:
        return this.#canScan(expression.expression, ruleName, rules);
    }
  }

  /** A token rule that contains trivia must keep its capture: fingerprints skip the trivia. */
  #reachesAny(
    name: string,
    targets: ReadonlySet<string>,
    seen: Set<string>,
  ): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    const visit = (expression: GrammarExpression): boolean => {
      switch (expression.kind) {
        case "literal":
        case "class":
        case "any":
        case "semanticAnd":
          return false;
        case "ruleRef":
          return targets.has(expression.name) ||
            this.#reachesAny(expression.name, targets, seen);
        case "sequence":
          return expression.elements.some(visit);
        case "choice":
          return expression.alternatives.some(visit);
        default:
          return visit(expression.expression);
      }
    };
    return visit(this.#rules.get(name)!);
  }

  /** Whether a discarded expression in `ruleName` can be scanned. */
  canScan(expression: GrammarExpression, ruleName: string): boolean {
    return this.#canScan(expression, ruleName, this.#lexical);
  }

  /** Whether a reference to the rule can scan it whole. */
  scansWholeRule(name: string): boolean {
    return this.#wholeRules.has(name);
  }

  /** A WM expression giving the end offset of the rule at `offset`, or -1. */
  ruleCall(name: string): string {
    this.#request(name);
    return `scan_${name}(source, offset)`;
  }

  /** A WM expression giving the end offset of `expression` at `offset`, or -1. */
  emit(expression: GrammarExpression): string {
    const body = strip(expression);
    if (body.kind === "ruleRef") return this.ruleCall(body.name);
    if (body.kind === "zeroOrMore") return `${this.#loop(body.expression)}(source, offset)`;
    const name = `scanPart_${this.#names++}`;
    this.#define(name, this.#tail(body));
    return `${name}(source, offset)`;
  }

  /** The scanner functions requested so far, as members of the rules' recursive group. */
  functions(): readonly string[] {
    while (this.#pending.length > 0) {
      const name = this.#pending.pop()!;
      this.#define(`scan_${name}`, this.#tail(this.#rules.get(name)!));
    }
    return this.#functions;
  }

  #define(name: string, body: string): void {
    this.#functions.push(
      `and ${name} = (source: String, offset: Number): Number => {`,
      indent(body, 1),
      "}",
    );
  }

  #request(name: string): void {
    if (this.#requested.has(name)) return;
    this.#requested.add(name);
    this.#pending.push(name);
  }

  #name(prefix: string): string {
    return `${prefix}${this.#names++}`;
  }

  /**
   * The expression as a function body, ending in its result. Everything is a `let` or an `if` in
   * tail position: a block used as a value would compile to a closure call.
   */
  #tail(expression: GrammarExpression): string {
    const body = strip(expression);
    switch (body.kind) {
      case "literal":
      case "class":
      case "any":
      case "ruleRef":
      case "zeroOrMore":
        return this.#binding(body, (let_, value) => `${let_}${value}`);
      case "sequence":
        return this.#sequence(body.elements, 0);
      case "choice":
        return this.#choice(body.alternatives, 0);
      case "optional":
        return this.#binding(body.expression, (let_, value) => {
          const end = this.#name("end");
          return `${let_}let ${end} = ${value};\nif (${end} >= 0) { ${end} } else { offset }`;
        });
      case "simpleNot":
        return this.#binding(body.expression, (let_, value) =>
          `${let_}if (${value} >= 0) { -1 } else { offset }`);
      case "oneOrMore":
        return this.#binding(body.expression, (let_, value) => {
          const end = this.#name("end");
          return `${let_}let ${end} = ${value};\nif (${end} > offset) { ${
            this.#loop(body.expression)
          }(source, ${end}) } else { -1 }`;
        });
      case "semanticAnd":
        throw new Error("semantic predicates are not scannable");
      case "labeled":
      case "text":
      case "group":
      case "action":
        throw new Error("unreachable: stripped above");
    }
  }

  /**
   * Passes `use` the expression's value: statements to run first (empty or newline-terminated) and
   * a WM expression free of block values. Anything larger becomes its own function.
   */
  #binding(expression: GrammarExpression, use: (lets: string, value: string) => string): string {
    const body = strip(expression);
    switch (body.kind) {
      case "ruleRef":
        return use("", this.ruleCall(body.name));
      case "zeroOrMore":
        return use("", `${this.#loop(body.expression)}(source, offset)`);
      case "any":
        return use("", "if (codeAt(source, offset) >= 0) { offset + 1 } else { -1 }");
      case "literal": {
        if (body.value.length === 0) return use("", "offset");
        if (body.value.length === 1) return this.#codeTest([[body.value, body.value]], false, use);
        const codes = Array.from(
          { length: body.value.length },
          (_, index) => body.value.charCodeAt(index),
        );
        const end = this.#name("end");
        return use(
          `let ${end} = literalEnd(source, ${this.#literalConstant(`[${codes.join(", ")}]`)}, offset);\n`,
          `if (${end} >= 0) { ${end} } else { -1 }`,
        );
      }
      case "class":
        return this.#codeTest(
          body.parts.map((part) => typeof part === "string" ? [part, part] : part),
          body.inverted,
          use,
        );
      default:
        return use("", this.emit(body));
    }
  }

  #codeTest(
    ranges: readonly (readonly [string, string])[],
    inverted: boolean,
    use: (lets: string, value: string) => string,
  ): string {
    const code = this.#name("code");
    const inside = ranges.map(([start, end]) =>
      `(${code} >= ${start.charCodeAt(0)} && ${code} <= ${end.charCodeAt(0)})`
    ).join(" || ");
    const test = inverted ? `${code} >= 0 && !(${inside})` : inside;
    return use(
      `let ${code} = codeAt(source, offset);\n`,
      `if (${test}) { offset + 1 } else { -1 }`,
    );
  }

  #sequence(elements: readonly GrammarExpression[], index: number): string {
    if (index === elements.length) return "offset";
    if (index === elements.length - 1) return this.#tail(elements[index]);
    return this.#binding(elements[index], (lets, value) => {
      const end = this.#name("end");
      return `${lets}let ${end} = ${value};\nif (${end} < 0) { -1 } else {\n  let offset = ${end};\n${
        indent(this.#sequence(elements, index + 1), 1)
      }\n}`;
    });
  }

  #choice(alternatives: readonly GrammarExpression[], index: number): string {
    if (index === alternatives.length) return "-1";
    if (index === alternatives.length - 1) return this.#tail(alternatives[index]);
    return this.#binding(alternatives[index], (lets, value) => {
      const end = this.#name("end");
      return `${lets}let ${end} = ${value};\nif (${end} >= 0) { ${end} } else {\n${
        indent(this.#choice(alternatives, index + 1), 1)
      }\n}`;
    });
  }

  /** A function repeating the expression while it makes progress; returns its name. */
  #loop(expression: GrammarExpression): string {
    const name = this.#name("scanLoop_");
    this.#define(
      name,
      this.#binding(expression, (lets, value) => {
        const end = this.#name("end");
        return `${lets}let ${end} = ${value};\nif (${end} > offset) { ${name}(source, ${end}) } else { offset }`;
      }),
    );
    return name;
  }
}

/** Removes wrappers that don't change what an expression consumes. */
function strip(expression: GrammarExpression): GrammarExpression {
  switch (expression.kind) {
    case "labeled":
    case "text":
    case "group":
    case "action":
      return strip(expression.expression);
    default:
      return expression;
  }
}

function indent(value: string, depth: number): string {
  const prefix = "  ".repeat(depth);
  return value.split("\n").map((line) => prefix + line).join("\n");
}
