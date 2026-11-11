import { coreFile } from "../compiler.ts";
import { emitCoreProgram } from "../core/emit_js.ts";

export async function compileIntegration(path: string) {
  const compiled = await coreFile(path);
  return {
    code: emitCoreProgram(compiled.core, { target: "library" }),
    dependencies: [...compiled.graph.nodes.values()].map((node) => node.path),
  };
}

if (import.meta.main) {
  try {
    const [path] = Deno.args;
    if (!path || Deno.args.length !== 1) throw new Error("Expected one WM module path");
    console.log(JSON.stringify(await compileIntegration(path)));
  } catch (error) {
    const failure = error as Error & { path?: string; originalError?: Error };
    console.error(
      `${failure.path ? `${failure.path}: ` : ""}${
        failure.originalError?.message ?? failure.message
      }`,
    );
    Deno.exitCode = 1;
  }
}
