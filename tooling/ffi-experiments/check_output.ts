// Capture inferred schemes and complete emitted JS without running the application.
import { coreFile } from "../../src/compiler.ts";
import { emitCoreProgram } from "../../src/core/emit_js.ts";
import { show } from "../../src/types.ts";
const result = await coreFile(Deno.args[0]);
const schemes = [...result.graph.nodes.values()].map((node) => ({
  path: node.path,
  bindings: [...result.results.get(node.id)!.env].map(([name, scheme]) => ({
    name,
    quantified: scheme.vars.length,
    type: show(scheme.type),
  })).sort((a, b) => a.name.localeCompare(b.name)),
})).sort((a, b) => a.path.localeCompare(b.path));
await Deno.writeTextFile(Deno.args[1] + ".schemes.json", JSON.stringify(schemes, null, 2) + "\n");
await Deno.writeTextFile(Deno.args[1] + ".js", emitCoreProgram(result.core));
console.log(`captured ${schemes.length} module environments and complete JS`);
