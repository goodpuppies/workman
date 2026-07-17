import type { ProgramAnalysis } from "../program_analysis.ts";
import type { GpuFragmentSelectorFact } from "../gpu_selection.ts";
import type {
  MaterializedGpuArtifacts,
  VisualShaderArtifactV1,
  VisualShaderResourceLayoutV5,
  VisualShaderUniformLayoutV2,
  VisualShaderUniformRepresentation,
} from "../gpu_artifact.ts";
import type { GpuSliceDiagnosticDto } from "./v2_dto.ts";
import { WmslangNumericDiagnosticError, type WmslangSliceCompiler } from "./v2_loader.ts";
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
  const artifacts = new Map<
    GpuFragmentSelectorFact["call"],
    VisualShaderArtifactV1
  >();
  for (const slice of analysis.gpuSlices) {
    const artifact = await materializeGpuSliceArtifact(
      slice.input,
      slice.selectors,
      compiler,
      backend,
    );
    for (const selector of slice.selectors) artifacts.set(selector.call, artifact);
  }
  return artifacts;
}

async function materializeGpuSliceArtifact(
  input: ProgramAnalysis["gpuInput"],
  selectors: GpuFragmentSelectorFact[],
  compiler: WmslangSliceCompiler,
  backend: WmslangSlangBackend,
): Promise<VisualShaderArtifactV1> {
  const primarySelector = selectors[0];
  if (!primarySelector) throw new Error("selected GPU slice has no selector");

  let lowered: ReturnType<WmslangSliceCompiler["compileGpuSlice"]>;
  try {
    lowered = compiler.compileGpuSlice(input);
  } catch (error) {
    if (error instanceof WmslangNumericDiagnosticError) {
      throw new WmslangSemanticError([error.diagnostic], input.spans);
    }
    throw error;
  }
  if (lowered.diagnostics.length !== 0) {
    throw new WmslangSemanticError(lowered.diagnostics, input.spans);
  }
  let compiled: ReturnType<WmslangSlangBackend["compile"]>;
  let layouts: {
    uniformLayout?: VisualShaderUniformLayoutV2;
    resourceLayout?: VisualShaderResourceLayoutV5;
  };
  try {
    compiled = backend.compile(lowered.slangSource);
    layouts = {
      ...materializedUniformLayout(
        input,
        lowered.shaderTypes,
        lowered.occurrences,
        compiled.uniformLayout,
        lowered.slangSource,
      ),
      ...materializedResourceLayout(
        input,
        compiled.resourceLayout,
        lowered.slangSource,
      ),
    };
  } catch (error) {
    if (!(error instanceof WmslangBackendError)) throw error;
    const root = input.functions.find((fn) => fn.id === input.root.functionId);
    if (!root) throw new Error("selected GPU root is missing during backend attribution");
    const diagnostic: GpuSliceDiagnosticDto = {
      code: error.code,
      message: error.message,
      spanId: input.root.selectorSpanId,
      related: [
        { spanId: root.spanId, label: `selected shader root ${root.name}` },
        ...uniqueBuiltinCallEvidence(lowered.irExpressions ?? []),
      ],
    };
    throw error.withSourceDiagnostic(
      resolveGpuSliceDiagnostic(diagnostic, input.spans),
    );
  }
  const artifact: VisualShaderArtifactV1 = {
    id: `wms-v1-${await artifactDigest(
      compiled.wgsl,
      layouts.uniformLayout,
      layouts.resourceLayout,
      input,
    )}`,
    wgsl: compiled.wgsl,
    vertexEntry: compiled.vertexEntry,
    fragmentEntry: compiled.fragmentEntry,
    ...layouts,
  };
  return artifact;
}

function uniqueBuiltinCallEvidence(
  expressions: ReturnType<WmslangSliceCompiler["compileGpuSlice"]>["irExpressions"],
): { spanId: number; label: string }[] {
  const seen = new Set<number>();
  return expressions.flatMap((expression) => {
    if (expression.kind !== "builtin" || seen.has(expression.spanId)) return [];
    seen.add(expression.spanId);
    return [{
      spanId: expression.spanId,
      label: `generated Slang builtin ${expression.builtinName}`,
    }];
  });
}

function materializedUniformLayout(
  input: ProgramAnalysis["gpuInput"],
  shaderTypes: ReturnType<WmslangSliceCompiler["compileGpuSlice"]>["shaderTypes"],
  occurrences: ReturnType<WmslangSliceCompiler["compileGpuSlice"]>["occurrences"],
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
  if (!environment) {
    throw reflectionMismatch(
      slangSource,
      "bound shader is missing its normalized environment",
    );
  }
  const sourceFields = environment.fieldIds.flatMap((id) => {
    const field = input.environmentFields.find((item) => item.id === id);
    return field?.kind === "uniform" ? [field] : [];
  });
  if (sourceFields.length === 0) {
    if (reflected) {
      throw reflectionMismatch(slangSource, "resource-only environment reflected uniform data");
    }
    return {};
  }
  if (!reflected) {
    throw reflectionMismatch(slangSource, "bound shader is missing its reflected uniform layout");
  }
  const fields = sourceFields.map((source) => {
    const uniformExpression = input.expressions.find((expression) =>
      expression.kind === "uniform" && expression.index === source.declaredIndex
    );
    const occurrence = uniformExpression
      ? occurrences.find((item) =>
        item.kind === "expression" && item.sourceId === uniformExpression.id
      )
      : undefined;
    const target = occurrence
      ? shaderTypes.find((item) => item.id === occurrence.shaderTypeId)
      : undefined;
    const actual = reflected.fields.find((field) => field.index === source.declaredIndex);
    if (!target || !actual) {
      throw reflectionMismatch(
        slangSource,
        `uniform field ${source.name} is missing from normalization or reflection`,
      );
    }
    const representation = uniformRepresentation(target, shaderTypes);
    const expectedByteLength = representation.includes("x") ? Number(representation.at(-1)) * 4 : 4;
    if (
      actual.index !== source.declaredIndex || actual.representation !== representation ||
      actual.byteLength !== expectedByteLength
    ) {
      throw reflectionMismatch(
        slangSource,
        `uniform field ${source.name} disagrees with Slang reflection: expected ${representation}/${expectedByteLength}, received ${actual.representation}/${actual.byteLength}`,
      );
    }
    return {
      name: source.name,
      declaredIndex: source.declaredIndex,
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

function materializedResourceLayout(
  input: ProgramAnalysis["gpuInput"],
  reflected: ReturnType<WmslangSlangBackend["compile"]>["resourceLayout"],
  slangSource: string,
): { resourceLayout?: VisualShaderResourceLayoutV5 } {
  if (input.root.environmentId === -1) {
    if (reflected) {
      throw reflectionMismatch(slangSource, "static shader unexpectedly reflected resources");
    }
    return {};
  }
  const environment = input.environments.find((item) => item.id === input.root.environmentId);
  if (!environment) {
    throw reflectionMismatch(slangSource, "bound shader is missing its normalized environment");
  }
  const sourceBindings = environment.fieldIds.flatMap((id) => {
    const field = input.environmentFields.find((item) => item.id === id);
    return field && field.kind !== "uniform" ? [field] : [];
  }).sort((left, right) => left.binding - right.binding);
  if (sourceBindings.length === 0) {
    if (reflected) {
      throw reflectionMismatch(slangSource, "uniform-only environment reflected GPU resources");
    }
    return {};
  }
  if (!reflected || reflected.group !== 0) {
    throw reflectionMismatch(slangSource, "bound shader is missing its reflected resource layout");
  }
  const bindings = sourceBindings.map((source) => {
    const actual = reflected.bindings.find((binding) => binding.binding === source.binding);
    if (
      !actual || actual.name !== `wm_r_${source.binding}` || actual.kind !== source.kind
    ) {
      throw reflectionMismatch(
        slangSource,
        `resource field ${source.name} disagrees with Slang reflection`,
      );
    }
    return {
      name: source.name,
      declaredIndex: source.declaredIndex,
      binding: source.binding,
      kind: source.kind,
    };
  });
  if (bindings.length !== reflected.bindings.length) {
    throw reflectionMismatch(slangSource, "normalized and reflected resources disagree");
  }
  return { resourceLayout: { recordName: environment.name, group: 0, bindings } };
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
  type: ReturnType<WmslangSliceCompiler["compileGpuSlice"]>["shaderTypes"][number],
  shaderTypes: ReturnType<WmslangSliceCompiler["compileGpuSlice"]>["shaderTypes"],
): VisualShaderUniformRepresentation {
  if (type.kind === "f32" || type.kind === "i32") return type.kind;
  if (type.kind === "vector" && type.items.length >= 2 && type.items.length <= 4) {
    const scalar = shaderTypes.find((item) => item.id === type.items[0]);
    if (scalar?.kind === "f32" || scalar?.kind === "i32") {
      return `${scalar.kind}x${type.items.length}` as VisualShaderUniformRepresentation;
    }
  }
  throw new Error(
    `unsupported materialized uniform representation ${type.kind}/${type.items.length}`,
  );
}

async function artifactDigest(
  wgsl: string,
  uniformLayout: VisualShaderUniformLayoutV2 | undefined,
  resourceLayout: VisualShaderResourceLayoutV5 | undefined,
  input: ProgramAnalysis["gpuInput"],
): Promise<string> {
  const root = input.functions.find((item) => item.id === input.root.functionId);
  if (!root) throw new Error("selected GPU root is missing while computing artifact identity");
  const identityManifest = JSON.stringify({
    wgsl,
    sourcePath: input.sourcePath,
    rootName: root.name,
    environment: uniformLayout
      ? {
        recordName: uniformLayout.recordName,
        binding: uniformLayout.binding,
        byteLength: uniformLayout.byteLength,
        fields: uniformLayout.fields,
      }
      : null,
    resources: resourceLayout ?? null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identityManifest),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
