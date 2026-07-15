import type { Module } from "./ast.ts";
import { compareSupportedFrontendSemantics } from "./frontend_v2_compare.ts";
import { loadFrontendV2 } from "./frontend_v2_loader.ts";
import { semanticProjectionToModule } from "./frontend_v2_semantic.ts";
import type { FrontendMode } from "./frontend_mode.ts";
import { parse, type Surface } from "./parser.ts";

export type CompilerFrontendOptions = {
  surface?: Surface;
  frontend?: FrontendMode;
  frontendV2ModuleUrl?: string | URL;
};

const defaultFrontendV2ModuleUrl = new URL(
  "../tooling/frontend-v2/frontend-v2.generated.mjs",
  import.meta.url,
);

export async function parseCompilerModule(
  source: string,
  options: CompilerFrontendOptions = {},
  filePath?: string,
): Promise<Module> {
  const mode = options.frontend ?? "v1";
  if (mode === "v1") return parse(source, options.surface, filePath);

  if (mode === "compare") {
    const frontend = await loadFrontendV2(
      options.frontendV2ModuleUrl ?? defaultFrontendV2ModuleUrl,
    );
    const comparison = await compareSupportedFrontendSemantics(source, frontend, {
      surface: options.surface,
    });
    if (!comparison.equivalent) {
      throw new Error(
        `frontend compare mode found differences: ${comparison.diagnostics.join("; ")}`,
      );
    }
    return parse(source, options.surface, filePath);
  }

  if (mode === "v2") {
    const frontend = await loadFrontendV2(
      options.frontendV2ModuleUrl ?? defaultFrontendV2ModuleUrl,
    );
    const projected = semanticProjectionToModule(frontend.projectSemantic(source), {
      source,
      structural: frontend.parseStructural(source),
    });
    if (projected.diagnostics.length) {
      throw new Error(
        `frontend v2 cannot project source: ${
          projected.diagnostics.map((diagnostic) => diagnostic.message).join("; ")
        }`,
      );
    }
    return projected.module;
  }

  throw new Error(`unknown frontend mode ${String(mode)}`);
}
