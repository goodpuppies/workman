import type { ProgramAnalysis } from "../program_analysis.ts";
import type { MaterializedGpuArtifacts, VisualShaderArtifactV1 } from "../gpu_artifact.ts";
import type { GpuSliceDiagnosticDto } from "./v2_dto.ts";
import type { WmslangSliceCompiler } from "./v2_loader.ts";
import { WmslangBackendError, type WmslangSlangBackend } from "./slang_backend.ts";
import {
  formatResolvedGpuDiagnostic,
  resolveGpuSliceDiagnostic,
  type WmslangResolvedDiagnostic,
} from "./diagnostics.ts";

export class WmslangSemanticError extends Error {
  readonly sourceDiagnostics: WmslangResolvedDiagnostic[];

  constructor(
    readonly diagnostics: GpuSliceDiagnosticDto[],
    spans: ProgramAnalysis["gpuInput"]["spans"],
  ) {
    const sourceDiagnostics = diagnostics.map((diagnostic) =>
      resolveGpuSliceDiagnostic(diagnostic, spans)
    );
    super(sourceDiagnostics.map(formatResolvedGpuDiagnostic).join("\n"));
    this.name = "WmslangSemanticError";
    this.sourceDiagnostics = sourceDiagnostics;
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
    throw new WmslangSemanticError(lowered.diagnostics, analysis.gpuInput.spans);
  }
  let compiled: ReturnType<WmslangSlangBackend["compile"]>;
  try {
    compiled = backend.compile(lowered.slangSource);
  } catch (error) {
    if (!(error instanceof WmslangBackendError)) throw error;
    const root = analysis.gpuInput.functions.find((fn) =>
      fn.id === analysis.gpuInput.root.functionId
    );
    if (!root) throw new Error("selected GPU root is missing during backend attribution");
    const diagnostic: GpuSliceDiagnosticDto = {
      code: error.code,
      message: error.message,
      spanId: analysis.gpuInput.root.selectorSpanId,
      related: [{ spanId: root.spanId, label: `selected shader root ${root.name}` }],
    };
    throw error.withSourceDiagnostic(
      resolveGpuSliceDiagnostic(diagnostic, analysis.gpuInput.spans),
    );
  }
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
