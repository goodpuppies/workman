import {
  hashGrammarIr,
  parseWorkmanGrammar,
  type WorkmanGrammarIr,
} from "./frontend_v2_grammar_ir.ts";
import {
  emitSurfaceRuleMetadata,
  emitSurfaceTypes,
} from "../tooling/frontend-v2/generator/surface_schema.ts";
import { emitCompiledProbe } from "../tooling/frontend-v2/generator/compiled_probe_emitter.ts";

export async function emitRecognizer(
  grammar: WorkmanGrammarIr,
): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  const grammarHash = await hashGrammarIr(grammar);
  const compiledProbe = emitCompiledProbe(grammar, grammarHash);
  files.set(
    "surface_types.wm",
    emitSurfaceTypes(grammar, grammarHash),
  );
  files.set(
    "surface_rule_metadata.wm",
    emitSurfaceRuleMetadata(grammar, grammarHash),
  );
  files.set(
    "recognizer_manifest.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        grammarHash: await hashGrammarIr(grammar),
        grammarPath: grammar.sourcePath,
        ruleCount: grammar.rules.length,
        compiledProbeModules: [...compiledProbe.keys()],
      },
      null,
      2,
    ) + "\n",
  );
  for (const [name, source] of compiledProbe) {
    files.set(name, source);
  }
  return files;
}

if (import.meta.main) {
  const grammarPath = Deno.args[0] ?? "src/grammar.peggy";
  const outputDirectory = Deno.args[1] ?? "tooling/frontend-v2/generated";
  const grammar = parseWorkmanGrammar(await Deno.readTextFile(grammarPath), grammarPath);
  const files = await emitRecognizer(grammar);
  await Deno.mkdir(outputDirectory, { recursive: true });
  for await (const entry of Deno.readDir(outputDirectory)) {
    if (
      entry.isFile &&
      entry.name.startsWith("compiled_probe_rules_") &&
      entry.name.endsWith(".wm") &&
      !files.has(entry.name)
    ) {
      await Deno.remove(`${outputDirectory}/${entry.name}`);
    }
  }
  for (const [name, source] of files) {
    await Deno.writeTextFile(`${outputDirectory}/${name}`, source);
  }
}
