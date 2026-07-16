import type { GpuSliceDiagnosticDto, GpuSliceSpanDto } from "./v2_dto.ts";

export type WmslangResolvedDiagnostic = {
  diagnostic: GpuSliceDiagnosticDto;
  primary: GpuSliceSpanDto;
  related: Array<{ label: string; span: GpuSliceSpanDto }>;
};

export function resolveGpuSliceDiagnostic(
  diagnostic: GpuSliceDiagnosticDto,
  spans: GpuSliceSpanDto[],
): WmslangResolvedDiagnostic {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const primary = byId.get(diagnostic.spanId);
  if (!primary) {
    throw new Error(`GPU diagnostic references missing primary span ${diagnostic.spanId}`);
  }
  return {
    diagnostic,
    primary,
    related: diagnostic.related.map(({ label, spanId }) => {
      const span = byId.get(spanId);
      if (!span) throw new Error(`GPU diagnostic references missing related span ${spanId}`);
      return { label, span };
    }),
  };
}

export function formatResolvedGpuDiagnostic(value: WmslangResolvedDiagnostic): string {
  const primary = `${value.primary.path}:${value.primary.line}:${value.primary.col}`;
  const related = value.related.map(({ label, span }) =>
    `\n  ${label}: ${span.path}:${span.line}:${span.col}`
  ).join("");
  return `${value.diagnostic.code}: ${value.diagnostic.message}\n  at ${primary}${related}`;
}
