import { relative, resolve } from "node:path";
import { semanticDocumentContext } from "./lsp/semantic_context.ts";
import { fileUriToPath, pathToFileUri } from "./lsp/uri.ts";
import { validateUri } from "./lsp/validation.ts";
import { lineColToOffset, lineStarts, offsetToLineCol, type SourceSpan } from "./source.ts";

export type TypedHole = Readonly<{
  kind: "hole";
  path: string;
  span: SourceSpan;
  lineText: string;
  expectedType: string;
}>;

export type TodoComment = Readonly<{
  kind: "comment";
  path: string;
  span: SourceSpan;
  lineText: string;
}>;

export type TodoDiagnostic = Readonly<{
  kind: "error" | "warning";
  path: string;
  span: SourceSpan;
  lineText: string;
  code: string;
  message: string;
}>;

export type TodoItem = TypedHole | TodoComment | TodoDiagnostic;

/** Collect diagnostics, authored `?` expressions, and TODO comments from one project. */
export async function collectTodos(input: string): Promise<TodoItem[]> {
  const uri = pathToFileUri(resolve(input));
  const [validation, context] = await Promise.all([
    validateUri(uri, new Map()),
    semanticDocumentContext(uri, new Map()),
  ]);
  const items: TodoItem[] = [];
  const sources = new Map<string, string>();
  if (context) {
    for (const moduleInterface of context.project.interfaces.values()) {
      const source = await Deno.readTextFile(moduleInterface.path);
      sources.set(moduleInterface.path, source);
      const lines = source.split(/\r?\n/);
      items.push(...todoComments(moduleInterface.path, source, lines));
      for (const node of moduleInterface.typedNodes) {
        if (
          node.kind !== "expression" || node.label !== "?" ||
          source.slice(node.span.start, node.span.end) !== "?"
        ) continue;
        items.push(Object.freeze({
          kind: "hole",
          path: moduleInterface.path,
          span: Object.freeze({ ...node.span }),
          lineText: lines[node.span.line - 1] ?? "",
          expectedType: moduleInterface.semanticTypes[node.type.id]?.rendered ?? "unknown",
        }));
      }
    }
  }
  for (const result of validation) {
    const path = fileUriToPath(result.uri);
    const source = sources.get(path) ?? await readSource(path);
    if (source === undefined) continue;
    sources.set(path, source);
    const starts = lineStarts(source);
    const lines = source.split(/\r?\n/);
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity !== 1 && diagnostic.severity !== 2) continue;
      const start = lineColToOffset(
        diagnostic.range.start.line + 1,
        diagnostic.range.start.character,
        starts,
      );
      const end = lineColToOffset(
        diagnostic.range.end.line + 1,
        diagnostic.range.end.character,
        starts,
      );
      items.push(Object.freeze({
        kind: diagnostic.severity === 1 ? "error" : "warning",
        path,
        span: Object.freeze({
          line: diagnostic.range.start.line + 1,
          col: diagnostic.range.start.character,
          start,
          end,
        }),
        lineText: lines[diagnostic.range.start.line] ?? "",
        code: diagnostic.code,
        message: conciseDiagnosticMessage(diagnostic.message),
      }));
    }
  }
  if (!context) {
    const path = fileUriToPath(uri);
    const source = sources.get(path) ?? await readSource(path);
    if (source !== undefined) {
      const lines = source.split(/\r?\n/);
      items.push(...todoComments(path, source, lines));
    }
  }
  return distinctItems(items).sort((left, right) =>
    left.path.localeCompare(right.path) || todoKindOrder(left.kind) - todoKindOrder(right.kind) ||
    left.span.start - right.span.start
  );
}

function distinctItems(items: readonly TodoItem[]): TodoItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const code = item.kind === "error" || item.kind === "warning" ? item.code : "";
    const key = [item.kind, item.path, item.span.start, item.span.end, code].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readSource(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

function conciseDiagnosticMessage(message: string): string {
  if (!message.includes("\n")) {
    return message.replace(/^(?:error|warning|information|hint)\[[^\]]+\]:\s*/i, "");
  }
  for (const line of message.split("\n")) {
    const caretMessage = line.match(/\^+\s+(.+)$/)?.[1];
    if (caretMessage) return caretMessage;
  }
  return message.split("\n")[0].trim();
}

export function formatTodos(
  items: readonly TodoItem[],
  currentDirectory = Deno.cwd(),
): string {
  if (items.length === 0) return "no errors, warnings, typed holes, or TODO comments found";
  const groups = new Map<string, TodoItem[]>();
  for (const item of items) {
    const path = displayPath(item.path, currentDirectory);
    const group = groups.get(path) ?? [];
    group.push(item);
    groups.set(path, group);
  }
  return [...groups].map(([path, group]) =>
    [
      `--- ${path} ---`,
      ...group.map((item) => formatTodoItem(path, item)),
    ].join("\n\n")
  ).join("\n\n");
}

function formatTodoItem(path: string, item: TodoItem): string {
  const line = String(item.span.line);
  const gutter = `${line} | `;
  const label = item.kind === "hole"
    ? `? expected ${item.expectedType}`
    : item.kind === "comment"
    ? "TODO comment"
    : `${item.kind}[${item.code}]: ${item.message}`;
  const marker = item.kind === "comment" ? "^^^^" : "^".repeat(
    Math.max(
      1,
      Math.min(item.span.end - item.span.start, item.lineText.length - item.span.col),
    ),
  );
  return [
    `${path}:${item.span.line}:${item.span.col + 1}: ${label}`,
    `${gutter}${item.lineText}`,
    `${" ".repeat(gutter.length + item.span.col)}${marker}`,
  ].join("\n");
}

function todoKindOrder(kind: TodoItem["kind"]): number {
  if (kind === "error") return 0;
  if (kind === "warning") return 1;
  return kind === "hole" ? 2 : 3;
}

function todoComments(path: string, source: string, lines: readonly string[]): TodoComment[] {
  const comments: TodoComment[] = [];
  const stack: ({ kind: "code"; interpolationDepth?: number } | { kind: "quoted" } | {
    kind: "template";
  })[] = [{ kind: "code" }];
  let index = 0;
  while (index < source.length) {
    const frame = stack.at(-1)!;
    const char = source[index];
    const next = source[index + 1];
    if (frame.kind === "quoted") {
      if (char === "\\") index += 2;
      else {
        index++;
        if (char === '"') stack.pop();
      }
      continue;
    }
    if (frame.kind === "template") {
      if (char === "\\") index += 2;
      else if (char === "`") {
        stack.pop();
        index++;
      } else if (char === "$" && next === "{") {
        stack.push({ kind: "code", interpolationDepth: 1 });
        index += 2;
      } else index++;
      continue;
    }
    if ((char === "-" && next === "-") || (char === "/" && next === "/")) {
      const end = source.indexOf("\n", index);
      const commentEnd = end === -1 ? source.length : end;
      const todo = source.indexOf("TODO", index + 2);
      if (todo !== -1 && todo < commentEnd) {
        const position = offsetToLineCol(source, todo);
        comments.push(Object.freeze({
          kind: "comment",
          path,
          span: Object.freeze({
            line: position.line,
            col: position.col,
            start: todo,
            end: todo + 4,
          }),
          lineText: lines[position.line - 1] ?? "",
        }));
      }
      index = commentEnd;
      continue;
    }
    if (char === '"') {
      stack.push({ kind: "quoted" });
      index++;
      continue;
    }
    if (char === "`") {
      stack.push({ kind: "template" });
      index++;
      continue;
    }
    if (frame.interpolationDepth !== undefined) {
      if (char === "{") frame.interpolationDepth++;
      if (char === "}") {
        frame.interpolationDepth--;
        if (frame.interpolationDepth === 0) stack.pop();
      }
    }
    index++;
  }
  return comments;
}

function displayPath(path: string, currentDirectory: string): string {
  const display = relative(resolve(currentDirectory), resolve(path));
  return display && !display.startsWith("..") ? display : path;
}
