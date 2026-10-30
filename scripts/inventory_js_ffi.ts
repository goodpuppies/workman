/** Syntax inventory, not type resolution or runtime profiling. Run from any directory. */
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { libraryImport } from "../src/host_modules.ts";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";
import type { JsImportClause, JsTarget } from "../src/ast.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
async function git(...args: string[]) {
  const result = await new Deno.Command("git", { args, cwd: repository, stdout: "piped" }).output();
  if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
  return new TextDecoder().decode(result.stdout);
}
const tracked = new Set((await git("ls-files", "-z", "--", "*.wm")).split("\0").filter(Boolean));
const untracked = (await git("ls-files", "--others", "--exclude-standard", "-z", "--", "*.wm"))
  .split("\0").filter((file) => file.startsWith("examples/") && file.endsWith(".wm"));
const files = [...tracked, ...untracked].sort();
function area(file: string) {
  if (file.startsWith("tooling/pakman/api/")) return "pakman";
  if (file.startsWith("subml-basis/")) return "shared-basis-generated";
  return file.includes("/") ? file.split("/")[0] : "root";
}
type Site = { file: string; line: number; tracked: boolean; area: string };
type ImportSite = Site & {
  target: string;
  kind: string;
  typeOnly: boolean;
  unsafe: boolean;
  namespace?: string;
  members: string[];
};
type AccessSite = Site & { kind: string; member: string; receiver?: string; spelling: string };
const imports: ImportSite[] = [];
const accesses: AccessSite[] = [];
const dotted: (AccessSite & { classification: string })[] = [];
const literals: (Site & { kind: string })[] = [];
const hostModules: (Site & { specifier: string; target: string })[] = [];
const errors: (Site & { message: string })[] = [];
const parsed: string[] = [];
const stdNamespaces = new Set<string>();
for await (const entry of Deno.readDir(join(repository, "std"))) {
  if (entry.name.endsWith(".wm")) {
    stdNamespaces.add(
      entry.name.slice(0, -3).split("_").map((s) => s[0].toUpperCase() + s.slice(1)).join(""),
    );
  }
}
const builtins = new Set([...stdNamespaces, "Js", "Text", "I32", "Gpu", "Foreign"]);
function targetName(target: JsTarget, file: string): string {
  switch (target.kind) {
    case "JsGlobalRoot":
      return "globalThis";
    case "JsGlobal":
      return target.path;
    case "JsModule":
      return /^(?:\.\.?\/)/.test(target.specifier)
        ? posix.normalize(posix.join(posix.dirname(file), target.specifier))
        : target.specifier;
    case "JsWorker":
      return target.specifier;
    case "JsMeta":
      return "import.meta";
    case "JsReceiver":
      return target.path.join(".");
    case "JsConstructor":
      return target.path;
    default:
      return target.kind;
  }
}
for (const file of files) {
  const source = await Deno.readTextFile(join(repository, file));
  const site = (node?: { span?: { line?: number } }): Site => ({
    file,
    line: node?.span?.line ?? 1,
    tracked: tracked.has(file),
    area: area(file),
  });
  let module;
  try {
    module = await parseCompilerModule(source, {}, file);
  } catch (error) {
    errors.push({ ...site(), message: String(error).split("\n")[0] });
    continue;
  }
  parsed.push(file);
  const namespaces = new Map<string, string>();
  const namedBindings = new Set<string>();
  const collected = new WeakSet<object>();
  const wmNamespaces = new Set(builtins);
  const seen = new Set<string>();
  // First collect authored imports, including imports nested inside blocks.
  function collect(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (collected.has(value)) return;
    collected.add(value);
    const node = value as Record<string, any>;
    if (node.kind === "ImportDecl") {
      if (node.clause.kind === "Namespace") wmNamespaces.add(node.clause.alias);
      const resolved = libraryImport(node.path)?.path ??
        posix.normalize(posix.join(posix.dirname(file), node.path));
      if (resolved.startsWith("host/js/")) {
        hostModules.push({ ...site(node.node), specifier: node.path, target: resolved });
      }
    }
    if (node.kind === "JsImportDecl") {
      const target = node.target as JsTarget;
      const clause = node.clause as JsImportClause;
      if (target.kind === "CHeader" || target.kind === "CLib") {
        if (clause.alias) wmNamespaces.add(clause.alias);
      } else {
        const targetLabel = targetName(target, file);
        imports.push({
          ...site(node.node),
          target: targetLabel,
          kind: target.kind,
          typeOnly: !!node.typeOnly,
          unsafe: !!clause.unsafe,
          namespace: clause.alias,
          members: clause.specs?.map((spec) => spec.name) ?? [],
        });
        if (clause.alias && !node.typeOnly) namespaces.set(clause.alias, targetLabel);
        if (!clause.alias && !node.typeOnly) {
          for (const spec of clause.specs ?? []) {
            const local = spec.alias ?? spec.name;
            namespaces.set(
              local,
              targetLabel === "globalThis" ? spec.name : targetLabel + "." + spec.name,
            );
            namedBindings.add(local);
          }
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (!["node", "implicitTerminatorSpan", "sourceClause"].includes(key)) {
        collect(child);
      }
    }
  }
  collect(module);
  function walk(value: unknown, parent?: Record<string, any>, key?: string) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((x) => walk(x, parent, key));
      return;
    }
    const node = value as Record<string, any>;
    if (node.kind === "FfiCall" || node.kind === "FfiGet") {
      const identity = `${node.kind}:${node.node?.span?.start}:${node.node?.span?.end}:${
        node.path.join(".")
      }`;
      if (!seen.has(identity)) {
        seen.add(identity);
        accesses.push({
          ...site(node.node),
          kind: node.kind === "FfiCall" ? "call" : "get",
          member: node.path.join("."),
          receiver: node.receiver?.kind === "Var" ? node.receiver.name : undefined,
          spelling: source.slice(node.node?.span?.start ?? 0, node.node?.span?.end ?? 0).replace(
            /\s+/g,
            " ",
          ).slice(0, 160),
        });
      }
    }
    if (node.kind === "JsonObject" || node.kind === "JsonArray") {
      const identity = `${node.kind}:${node.node?.span?.start}:${node.node?.span?.end}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        literals.push({ ...site(node.node), kind: node.kind });
      }
    }
    if (node.kind === "Var" && (node.name.includes(".") || namedBindings.has(node.name))) {
      const root = node.name.split(".")[0];
      const classification = root === "Js"
        ? "builtin-js"
        : namedBindings.has(root)
        ? "imported-js-binding"
        : namespaces.has(root)
        ? "imported-js-namespace"
        : wmNamespaces.has(root)
        ? "wm-namespace"
        : "unresolved-dotted";
      const identity = `var:${node.node?.span?.start}:${node.node?.span?.end}:${node.name}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        dotted.push({
          ...site(node.node),
          classification,
          member: namespaces.has(root)
            ? namespaces.get(root) + node.name.slice(root.length)
            : node.name,
          kind: parent?.kind === "Call" && key === "callee" ? "call" : "reference",
          spelling: node.name,
        });
      }
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (
        !["node", "implicitTerminatorSpan", "sourceClause"].includes(childKey)
      ) walk(child, node, childKey);
    }
  }
  walk(module);
}
function rank<T extends Site>(rows: T[], key: (row: T) => string) {
  const groups = new Map<
    string,
    { name: string; sites: number; files: Set<string>; examples: Site[] }
  >();
  for (const row of rows) {
    const name = key(row);
    const group = groups.get(name) ?? { name, sites: 0, files: new Set<string>(), examples: [] };
    group.sites++;
    group.files.add(row.file);
    if (group.examples.length < 3 && !group.examples.some((x) => x.file === row.file)) {
      group.examples.push(row);
    }
    groups.set(name, group);
  }
  return [...groups.values()].map((x) => ({ ...x, files: x.files.size })).sort((a, b) =>
    b.sites - a.sites || a.name.localeCompare(b.name)
  );
}
const runtimeImports = imports.filter((x) => !x.typeOnly);
const areas = [...new Set(files.map(area))].sort().map((name) => ({
  name,
  files: files.filter((file) => area(file) === name).length,
  parsed: parsed.filter((file) => area(file) === name).length,
  runtimeImports: runtimeImports.filter((row) => row.area === name).length,
  typeImports: imports.filter((row) => row.area === name && row.typeOnly).length,
  unsafeImports: runtimeImports.filter((row) => row.area === name && row.unsafe).length,
  receiverCalls: accesses.filter((row) => row.area === name && row.kind === "call").length,
  receiverGets: accesses.filter((row) => row.area === name && row.kind === "get").length,
  builtinJs:
    dotted.filter((row) => row.area === name && row.classification === "builtin-js").length,
  foreignNamespace:
    dotted.filter((row) => row.area === name && row.classification === "imported-js-namespace")
      .length,
  unresolvedDotted:
    dotted.filter((row) => row.area === name && row.classification === "unresolved-dotted").length,
}));
const rankings = Object.fromEntries(
  ["std", "examples", "tooling", "host", "pakman", "shared-basis-generated"].map((name) => {
    const rows = runtimeImports.filter((x) => x.area === name);
    const receivers = accesses.filter((x) => x.area === name);
    return [name, {
      imports: rank(rows, (x) => x.target),
      importedMembers: rank(
        rows.flatMap((x) =>
          x.members.map((member) => ({
            ...x,
            symbol: x.target === "globalThis" ? member : x.target + "." + member,
          }))
        ),
        (x) => x.symbol,
      ),
      receiverMembers: rank(receivers, (x) => x.member),
      calls: rank(receivers.filter((x) => x.kind === "call"), (x) => x.member),
      gets: rank(receivers.filter((x) => x.kind === "get"), (x) => x.member),
      builtinJs: rank(
        dotted.filter((x) => x.area === name && x.classification === "builtin-js"),
        (x) => x.member,
      ),
      foreignBindings: rank(
        dotted.filter((x) => x.area === name && x.classification === "imported-js-binding"),
        (x) => x.member,
      ),
      foreignNamespace: rank(
        dotted.filter((x) => x.area === name && x.classification === "imported-js-namespace"),
        (x) => x.member,
      ),
    }];
  }),
);
console.log(
  JSON.stringify(
    {
      revision: (await git("rev-parse", "HEAD")).trim(),
      policy:
        "Tracked WM sources plus untracked examples; raw syntax, no type/ownership resolution; C import declarations excluded; failed files excluded from AST counts.",
      areas,
      rankings,
      literals,
      untracked,
      errors,
      imports,
      accesses,
      hostModules,
      dotted: dotted.filter((x) => x.classification !== "wm-namespace"),
    },
    null,
    2,
  ),
);
