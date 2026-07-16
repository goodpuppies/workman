import type { ProgramAnalysis } from "../program_analysis.ts";
import type {
  MaterializedGpuArtifacts,
  VisualShaderArtifactV1,
  VisualShaderUniformLayoutV2,
  VisualShaderUniformRepresentation,
} from "../gpu_artifact.ts";
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
  let uniformLayout: { uniformLayout?: VisualShaderUniformLayoutV2 };
  try {
    compiled = backend.compile(lowered.slangSource);
    uniformLayout = materializedUniformLayout(
      analysis.gpuInput,
      lowered.shaderTypes,
      compiled.uniformLayout,
      lowered.slangSource,
    );
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
    id: `wms-v1-${await artifactDigest(compiled.wgsl, uniformLayout.uniformLayout, analysis)}`,
    wgsl: compiled.wgsl,
    vertexEntry: compiled.vertexEntry,
    fragmentEntry: compiled.fragmentEntry,
    ...uniformLayout,
  };
  return new Map([[selectors[0].call, artifact]]);
}

function materializedUniformLayout(
  input: ProgramAnalysis["gpuInput"],
  shaderTypes: ReturnType<WmslangSliceCompiler["compileGpuSlice"]>["shaderTypes"],
  reflected: ReturnType<WmslangSlangBackend["compile"]>["uniformLayout"],
  slangSource: string,
): { uniformLayout?: VisualShaderUniformLayoutV2 } {
  if (input.root.environmentId === -1) {
    if (reflected) {
      throw reflectionMismatch(
        slangSource,
        "static shader unexpectedly reflected a uniform environment",
      );
    }
    return {};
  }
  const environment = input.environments.find((item) => item.id === input.root.environmentId);
  if (!environment || !reflected) {
    throw reflectionMismatch(
      slangSource,
      "bound shader is missing normalized or reflected uniform layout",
    );
  }
  const fields = environment.fieldIds.map((id, declaredIndex) => {
    const source = input.environmentFields.find((item) => item.id === id);
    const target = source ? shaderTypes.find((item) => item.id === source.typeId) : undefined;
    const actual = reflected.fields[declaredIndex];
    if (!source || source.declaredIndex !== declaredIndex || !target || !actual) {
      throw reflectionMismatch(
        slangSource,
        `uniform field ${declaredIndex} is missing from normalization or reflection`,
      );
    }
    const representation = uniformRepresentation(target.kind, target.items.length);
    const expectedByteLength = representation === "f32" ? 4 : Number(representation.at(-1)) * 4;
    if (
      actual.index !== declaredIndex || actual.representation !== representation ||
      actual.byteLength !== expectedByteLength
    ) {
      throw reflectionMismatch(
        slangSource,
        `uniform field ${source.name} disagrees with Slang reflection: expected ${representation}/${expectedByteLength}, received ${actual.representation}/${actual.byteLength}`,
      );
    }
    return {
      name: source.name,
      declaredIndex,
      representation,
      offset: actual.offset,
      byteLength: actual.byteLength,
    };
  });
  if (fields.length !== reflected.fields.length || reflected.binding !== 0) {
    throw reflectionMismatch(slangSource, "normalized and reflected uniform fields disagree");
  }
  return {
    uniformLayout: {
      recordName: environment.name,
      binding: 0,
      byteLength: reflected.byteLength,
      fields,
    },
  };
}

function reflectionMismatch(slangSource: string, diagnostic: string): WmslangBackendError {
  return new WmslangBackendError(
    "Slang reflection disagrees with the normalized shader environment",
    slangSource,
    diagnostic,
    "gpu.backend.reflection",
  );
}

function uniformRepresentation(
  kind: string,
  width: number,
): VisualShaderUniformRepresentation {
  if (kind === "f32") return "f32";
  if (kind === "vector" && width >= 2 && width <= 4) {
    return `f32x${width}` as VisualShaderUniformRepresentation;
  }
  throw new Error(`unsupported materialized uniform representation ${kind}/${width}`);
}

async function artifactDigest(
  wgsl: string,
  uniformLayout: VisualShaderUniformLayoutV2 | undefined,
  analysis: ProgramAnalysis,
): Promise<string> {
  const root = analysis.gpuInput.functions.find((item) =>
    item.id === analysis.gpuInput.root.functionId
  );
  if (!root) throw new Error("selected GPU root is missing while computing artifact identity");
  const identityManifest = JSON.stringify({
    wgsl,
    sourcePath: analysis.gpuInput.sourcePath,
    rootName: root.name,
    environment: uniformLayout
      ? {
        recordName: uniformLayout.recordName,
        binding: uniformLayout.binding,
        byteLength: uniformLayout.byteLength,
        fields: uniformLayout.fields,
      }
      : null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identityManifest),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
