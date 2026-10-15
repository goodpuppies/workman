import { compileLibraryFile } from "../../../../src/compiler.ts";
import { type Edit, type InlineHint, list } from "./preview.ts";

type Variant = { name: string; args: any[] };
export type EditorResult = {
  source: string;
  projected: string;
  preview: string;
  document: unknown[];
  edits: Edit[];
  additions: {
    id: number;
    anchor: number;
    text: string;
    projectedStart: number;
    projectedEnd: number;
    syntaxMark: number | null;
    delimiter: number | null;
  }[];
  hints: InlineHint[];
};

// Bootstrap and transport only. The actual WM parser/projector/diff own all behavior.
export async function loadEditor() {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(
      path,
      await compileLibraryFile(
        new URL("./editor.wm", import.meta.url).pathname,
      ),
    );
    const runtime = await import(`file://${path}`);
    const text = (source: unknown) =>
      list<number>(runtime.units(source))
        .map((unit) => String.fromCharCode(unit)).join("");
    const optionalId = (value: Variant): number | null => {
      if (value.name === "None") return null;
      if (value.name === "Some") return value.args[0].args[0];
      throw new Error("Invalid WM option in editor transport");
    };
    return (source: string, marked = false): EditorResult => {
      const result = runtime.inspect([source, marked]) as Variant;
      if (result.name === "Err") {
        throw new Error(`Editor view failed: ${JSON.stringify(result)}`);
      }
      if (result.name !== "Ok") throw new Error("Invalid WM editor result");
      const view = result.args[0];
      return {
        source,
        projected: text(view.projection.text),
        preview: text(view.preview.rendered),
        document: JSON.parse(runtime.encode(view.document)),
        edits: list<any>(view.difference.edits).map((edit) => ({
          kind: edit.kind.name,
          originalStart: edit.originalStart,
          originalEnd: edit.originalEnd,
          projectedStart: edit.projectedStart,
          projectedEnd: edit.projectedEnd,
        })),
        additions: list<any>(view.additions).map((item) => ({
          id: item.addition.insertion.insertionId,
          anchor: item.addition.insertion.anchor,
          text: text(item.addition.insertion.content),
          projectedStart: item.addition.projectedStart,
          projectedEnd: item.addition.projectedEnd,
          syntaxMark: optionalId(item.syntaxMark),
          delimiter: optionalId(item.delimiter),
        })),
        hints: list<any>(runtime.inlineHints(view.preview)).map((hint) => ({
          position: { line: hint.position.line, character: hint.position.col },
          label: text(hint.label),
          paddingLeft: hint.paddingLeft,
          paddingRight: hint.paddingRight,
          data: { insertionId: hint.insertionId, sourceOffset: hint.position.index },
        })),
      };
    };
  } finally {
    await Deno.remove(path);
  }
}
