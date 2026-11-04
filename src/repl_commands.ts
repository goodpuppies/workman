/**
 * A `:` followed by a letter, as in Scala's REPL, so an operator can't be taken for a command. Only
 * comments may come first, since a comment after one phrase's `;` carries into the next input.
 */
const COMMAND = /^(?:\s|(?:\/\/|--)[^\n]*(?:\n|$))*:([a-zA-Z][^\s;]*)\s*([\s\S]*)$/;

export type ReplCommandDescription = {
  name: string;
  usage: string;
  summary: string;
  detail: string;
  /** Its argument is an expression, which can always continue, so only `;` can end it. */
  takesExpression?: boolean;
};

export const REPL_COMMANDS: readonly ReplCommandDescription[] = [
  {
    name: "help",
    usage: ":help [command]",
    summary: "show this list, or the details of one command",
    detail: "With no argument, lists every command and the main keys.",
  },
  {
    name: "type",
    usage: ":type <expression>;",
    summary: "show an expression's type without running it",
    detail: "Nothing runs and no binding changes, so this is safe for code with side effects.\n" +
      "A ! in the type marks an expression with effects, as in Void!.",
    takesExpression: true,
  },
];

export function isReplCommand(text: string): boolean {
  return COMMAND.test(text);
}

/** Whether this command, like a phrase, isn't finished until its top-level `;`. */
export function replCommandNeedsSemicolon(
  text: string,
  commands: readonly ReplCommandDescription[] = REPL_COMMANDS,
): boolean {
  const parsed = parseReplCommand(text, commands);
  return parsed.kind === "command" &&
    commands.some((command) => command.name === parsed.name && command.takesExpression);
}

export type ParsedReplCommand =
  | { kind: "command"; name: string; argument: string }
  | { kind: "error"; message: string };

/** Resolves a command by its full name or any prefix that fits only one command. */
export function parseReplCommand(
  text: string,
  commands: readonly ReplCommandDescription[] = REPL_COMMANDS,
): ParsedReplCommand {
  const match = COMMAND.exec(text);
  if (!match) return { kind: "error", message: `not a command: ${text.trim()}` };
  const [, typed, rest] = match;
  const found = resolveCommand(typed, commands);
  if (found.kind === "error") return found;
  // The `;` ends the argument rather than being part of it.
  return { kind: "command", name: found.name, argument: rest.trim().replace(/;\s*$/, "").trim() };
}

function resolveCommand(
  typed: string,
  commands: readonly ReplCommandDescription[],
): { kind: "found"; name: string } | { kind: "error"; message: string } {
  const exact = commands.find((command) => command.name === typed);
  if (exact) return { kind: "found", name: exact.name };
  const matches = commands.filter((command) => command.name.startsWith(typed));
  if (matches.length === 1) return { kind: "found", name: matches[0].name };
  if (matches.length === 0) {
    return { kind: "error", message: `unknown command :${typed}; try :help` };
  }
  const names = matches.map((command) => `:${command.name}`).join(", ");
  return { kind: "error", message: `ambiguous command :${typed}: could be ${names}` };
}

/** The text for `:help`, generated from the table so it can't drift from the commands. */
export function replHelpText(
  argument = "",
  commands: readonly ReplCommandDescription[] = REPL_COMMANDS,
): string {
  if (argument) {
    const found = resolveCommand(argument.replace(/^:/, ""), commands);
    if (found.kind === "error") return found.message;
    const command = commands.find((item) => item.name === found.name)!;
    return `${command.usage}\n  ${command.summary}\n\n${command.detail}`;
  }
  const width = Math.max(...commands.map((command) => command.usage.length));
  const rows = commands.map((command) => `  ${command.usage.padEnd(width)}  ${command.summary}`);
  return [
    "Commands (any unambiguous prefix works, like :t):",
    ...rows,
    "",
    "Keys:",
    "  Enter        run an input ending in ; or a command with no expression, otherwise add a line",
    "  Shift+Enter  add the missing ; and run (Alt+Enter on terminals without Shift+Enter)",
    "  Ctrl+J       always add a line",
    "  Up/Down      move between lines, then through history",
    "  Ctrl-C       discard the input; exit if it is empty",
    "",
    "Ctrl-D or quit() exits.",
  ].join("\n");
}
