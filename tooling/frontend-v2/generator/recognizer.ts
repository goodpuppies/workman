import type {
  GrammarExpression,
  WorkmanGrammarIr,
} from "../../../scripts/frontend_v2_grammar_ir.ts";

type Match = Readonly<{ offset: number }> | null;

export function recognizeGrammar(
  grammar: WorkmanGrammarIr,
  source: string,
  startRule = "Start",
): boolean {
  const rules = new Map(grammar.rules.map((rule) => [rule.name, rule.expression]));
  if (!rules.has(startRule)) throw new Error(`unknown start rule ${startRule}`);

  const active = new Set<string>();
  const memo = new Map<string, Match>();

  const matchRule = (name: string, offset: number): Match => {
    const expression = rules.get(name);
    if (!expression) throw new Error(`unknown rule reference ${name}`);
    const key = `${name}@${offset}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    if (active.has(key)) throw new Error(`left recursion at ${key}`);
    active.add(key);
    try {
      const matched = matchExpression(expression, offset);
      memo.set(key, matched);
      return matched;
    } finally {
      active.delete(key);
    }
  };

  const repeat = (
    expression: GrammarExpression,
    offset: number,
    requireOne: boolean,
  ): Match => {
    let cursor = offset;
    let count = 0;
    while (true) {
      const matched = matchExpression(expression, cursor);
      if (!matched) break;
      if (matched.offset === cursor) {
        throw new Error(`repetition made no progress at offset ${cursor}`);
      }
      cursor = matched.offset;
      count += 1;
    }
    return requireOne && count === 0 ? null : Object.freeze({ offset: cursor });
  };

  const matchExpression = (expression: GrammarExpression, offset: number): Match => {
    switch (expression.kind) {
      case "literal": {
        const candidate = source.slice(offset, offset + expression.value.length);
        const matches = expression.ignoreCase
          ? candidate.toLowerCase() === expression.value.toLowerCase()
          : candidate === expression.value;
        return matches ? Object.freeze({ offset: offset + expression.value.length }) : null;
      }
      case "class": {
        if (offset >= source.length) return null;
        const value = source.charAt(offset);
        const comparable = expression.ignoreCase ? value.toLowerCase() : value;
        const contains = expression.parts.some((part) => {
          if (typeof part === "string") {
            return comparable === (expression.ignoreCase ? part.toLowerCase() : part);
          }
          const start = expression.ignoreCase ? part[0].toLowerCase() : part[0];
          const end = expression.ignoreCase ? part[1].toLowerCase() : part[1];
          return comparable >= start && comparable <= end;
        });
        return contains !== expression.inverted ? Object.freeze({ offset: offset + 1 }) : null;
      }
      case "any":
        return offset < source.length ? Object.freeze({ offset: offset + 1 }) : null;
      case "ruleRef":
        return matchRule(expression.name, offset);
      case "sequence": {
        let cursor = offset;
        for (const element of expression.elements) {
          const matched = matchExpression(element, cursor);
          if (!matched) return null;
          cursor = matched.offset;
        }
        return Object.freeze({ offset: cursor });
      }
      case "choice":
        for (const alternative of expression.alternatives) {
          const matched = matchExpression(alternative, offset);
          if (matched) return matched;
        }
        return null;
      case "labeled":
      case "text":
      case "group":
      case "action":
        return matchExpression(expression.expression, offset);
      case "simpleNot":
        return matchExpression(expression.expression, offset) === null
          ? Object.freeze({ offset })
          : null;
      case "optional":
        return matchExpression(expression.expression, offset) ?? Object.freeze({ offset });
      case "zeroOrMore":
        return repeat(expression.expression, offset, false);
      case "oneOrMore":
        return repeat(expression.expression, offset, true);
      case "semanticAnd":
        if (expression.actionId !== "Start:root.expression.elements.0") {
          throw new Error(`unclassified semantic predicate ${expression.actionId}`);
        }
        return Object.freeze({ offset });
    }
  };

  const matched = matchRule(startRule, 0);
  return matched !== null && matched.offset === source.length;
}
