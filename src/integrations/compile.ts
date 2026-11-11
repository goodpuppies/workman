import { coreFile } from "../compiler.ts";
import { emitCoreProgram } from "../core/emit_js.ts";

// Keep the compiler in its Deno environment; Vite and Bun only receive JS and watch paths.
try {
  const [path] = Deno.args;
  if (!path || Deno.args.length !== 1) throw new Error("Expected one WM module path");
  const compiled = await coreFile(path);
  const code = emitCoreProgram(compiled.core, { target: "library" });
  console.log(JSON.stringify({
    code,
    dependencies: [...compiled.graph.nodes.values()].map((node) => node.path),
  }));
} catch (error) {
  const failure = error as Error & { path?: string; originalError?: Error };
  console.error(
    `${failure.path ? `${failure.path}: ` : ""}${
      failure.originalError?.message ?? failure.message
    }`,
  );
  Deno.exitCode = 1;
}
