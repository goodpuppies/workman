/** TypeScript 7.1 content mapper wire types (JSON-RPC over stdio).
 * https://github.com/microsoft/typescript-go/pull/4712
 */
export type SpanMapping = [
  virtualStart: number,
  virtualLength: number,
  originalStart: number,
  originalLength: number,
  kind: 0 | 1 | 2,
  features?: number,
];

export type MapperDiagnostic = {
  messageText: string;
  start: number;
  length: number;
  code: number;
};

export type TransformResult = {
  text: string;
  extension: ".ts";
  mappings: SpanMapping[];
  diagnostics: MapperDiagnostic[];
};
