import type { ProgramAnalysis } from "../program_analysis.ts";
import type { MaterializedGpuArtifacts, VisualShaderArtifactV1 } from "../gpu_artifact.ts";
import type { GpuSliceDiagnosticDto } from "./v2_dto.ts";
import type { WmslangSliceCompiler } from "./v2_loader.ts";
import type { WmslangSlangBackend } from "./slang_backend.ts";

export class WmslangSemanticError extends Error {
  constructor(readonly diagnostics: GpuSliceDiagnosticDto[]) {
    super(diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
    this.name = "WmslangSemanticError";
  }
}

export async function materializeGpuSliceArtifacts(
  analysis: ProgramAnalysis,
  compiler: WmslangSliceCompiler,
  backend: WmslangSlangBackend,
): Promise<MaterializedGpuArtifacts> {
  if (analysis.gpuInput.root.functionId === -1) return new Map();
  const selectors = analysis.fragmentSelections.selectors;
  if (selectors.length !== 1) {
    throw new Error("visual-v1 materialization requires exactly one selected Gpu.fragment call");
  }

  const lowered = compiler.compileGpuSlice(analysis.gpuInput);
  if (lowered.diagnostics.length !== 0) {
    throw new WmslangSemanticError(lowered.diagnostics);
  }
  const compiled = backend.compile(lowered.slangSource);
  const artifact: VisualShaderArtifactV1 = {
    id: `wms-v1-${await artifactDigest(compiled.wgsl)}`,
    wgsl: compiled.wgsl,
    vertexEntry: compiled.vertexEntry,
    fragmentEntry: compiled.fragmentEntry,
  };
  return new Map([[selectors[0].call, artifact]]);
}

async function artifactDigest(wgsl: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wgsl));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
