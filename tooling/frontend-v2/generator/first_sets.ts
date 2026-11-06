import type {
  GrammarExpression,
  WorkmanGrammarIr,
} from "../../../scripts/frontend_v2_grammar_ir.ts";

/**
 * The UTF-16 code units an expression can start with, for skipping choice alternatives that
 * cannot match the next code unit.
 *
 * `nullable` expressions can match without consuming input and `any` ones can start with any code
 * unit; neither can be skipped. Recovery changes the sets: with recovery active, a recoverable
 * literal (`;`, `{`, `}`) can match empty by inventing a missing token, so it is nullable. Every
 * set is a superset of what the generated parser can actually start with, which is what makes
 * skipping exact.
 */
export type FirstSet = Readonly<{
  nullable: boolean;
  any: boolean;
  /** Sorted, disjoint, non-adjacent inclusive ranges. */
  ranges: readonly (readonly [number, number])[];
}>;

/** How the emitter passes recovery into subexpressions; mirrored here exactly. */
export type FirstSetPolicy = Readonly<{
  isRecoverableLiteral: (ruleName: string, value: string) => boolean;
  /** `zeroOrMore` keeps the enclosing recovery mode only in these rules; elsewhere it is strict. */
  recoveryRepetitionRules: ReadonlySet<string>;
}>;

const NULLABLE: FirstSet = { nullable: true, any: false, ranges: [] };
const ANY: FirstSet = { nullable: false, any: true, ranges: [] };

export class FirstSets {
  readonly #rules: ReadonlyMap<string, GrammarExpression>;
  readonly #policy: FirstSetPolicy;
  readonly #done = new Map<string, FirstSet>();
  readonly #active = new Set<string>();

  constructor(grammar: WorkmanGrammarIr, policy: FirstSetPolicy) {
    this.#rules = new Map(grammar.rules.map((rule) => [rule.name, rule.expression]));
    this.#policy = policy;
  }

  /** FIRST of an expression inside `ruleName`, with recovery active or not. */
  of(expression: GrammarExpression, ruleName: string, recovering: boolean): FirstSet {
    switch (expression.kind) {
      case "literal": {
        if (expression.value.length === 0) return NULLABLE;
        const code = expression.value.charCodeAt(0);
        const recoverable = recovering &&
          this.#policy.isRecoverableLiteral(ruleName, expression.value);
        return { nullable: recoverable, any: false, ranges: [[code, code]] };
      }
      case "class": {
        if (expression.inverted || expression.ignoreCase) return ANY;
        return normalize(
          false,
          expression.parts.map((part) =>
            typeof part === "string"
              ? [part.charCodeAt(0), part.charCodeAt(0)] as const
              : [part[0].charCodeAt(0), part[1].charCodeAt(0)] as const
          ),
        );
      }
      case "any":
        return ANY;
      case "ruleRef":
        return this.rule(expression.name, recovering);
      case "sequence": {
        const parts: FirstSet[] = [];
        for (const element of expression.elements) {
          const first = this.of(element, ruleName, recovering);
          parts.push(first);
          if (first.any) return ANY;
          if (!first.nullable) return union(parts, false);
        }
        // Every element can match empty.
        return union(parts, true);
      }
      case "choice": {
        // BlockSeqItem's second alternative is emitted strict while recovering.
        const strictSecond = ruleName === "BlockSeqItem";
        const alternatives = expression.alternatives.map((alternative, index) =>
          this.of(alternative, ruleName, recovering && !(strictSecond && index === 1))
        );
        return union(alternatives, alternatives.some((alternative) => alternative.nullable));
      }
      case "labeled":
      case "text":
      case "group":
      case "action":
        return this.of(expression.expression, ruleName, recovering);
      case "simpleNot":
      case "semanticAnd":
        return NULLABLE;
      case "optional":
        return union([this.of(expression.expression, ruleName, false)], true);
      case "zeroOrMore":
        return union([
          this.of(
            expression.expression,
            ruleName,
            recovering && this.#policy.recoveryRepetitionRules.has(ruleName),
          ),
        ], true);
      case "oneOrMore":
        return this.of(expression.expression, ruleName, false);
    }
  }

  rule(name: string, recovering: boolean): FirstSet {
    const key = `${name}\u0000${recovering}`;
    const known = this.#done.get(key);
    if (known) return known;
    const expression = this.#rules.get(name);
    // An unknown rule, or a rule reached again through its own nullable prefix, can't be bounded.
    if (!expression || this.#active.has(key)) return ANY;
    this.#active.add(key);
    // A rule called with recovery active may first be probed strictly, then with recovery; the
    // recovering set contains the strict one.
    const first = this.of(expression, name, recovering);
    this.#active.delete(key);
    this.#done.set(key, first);
    return first;
  }
}

/** Whether skipping on this set is possible at all. */
export function isGuardable(first: FirstSet): boolean {
  return !first.nullable && !first.any && first.ranges.length > 0;
}

/** A WM boolean expression testing `code` against the set. */
export function emitFirstCheck(first: FirstSet, code: string): string {
  // Ranges, not `==`: number equality compiles to the structural `__wm_eq`.
  return first.ranges.map(([start, end]) => `(${code} >= ${start} && ${code} <= ${end})`).join(
    " || ",
  );
}

function union(parts: readonly FirstSet[], nullable: boolean): FirstSet {
  if (parts.some((part) => part.any)) return ANY;
  return normalize(nullable, parts.flatMap((part) => part.ranges));
}

function normalize(nullable: boolean, ranges: readonly (readonly [number, number])[]): FirstSet {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return { nullable, any: false, ranges: merged };
}
