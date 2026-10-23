import { compileLibraryFile } from "../../../../src/compiler.ts";

type Variant = { name: string; args: unknown[]; [field: string]: unknown };
export type Insertion = { id: number; anchor: number; text: string };
export type Placement = {
  id: number;
  anchor: number;
  text: string;
  position: { index: number; line: number; col: number };
  previewStart: number;
  previewEnd: number;
};
export type InlineHint = {
  position: { line: number; character: number };
  label: string;
  paddingLeft: boolean;
  paddingRight: boolean;
  data: { insertionId: number; sourceOffset: number };
};
export type Preview = {
  text: string;
  units: number[];
  placements: Placement[];
  hints: InlineHint[];
};
export type Edit = {
  kind: "Keep" | "Insert" | "Delete";
  originalStart: number;
  originalEnd: number;
  projectedStart: number;
  projectedEnd: number;
};
export type Difference = Preview & { projected: string; edits: Edit[] };

export function list<T>(value: Variant): T[] {
  const items: T[] = [];
  while (value.name === "Cons") {
    const [head, tail] = value.args[0] as [T, Variant];
    items.push(head);
    value = tail;
  }
  if (value.name !== "Nil") throw new Error("Invalid WM list in preview transport");
  return items;
}

// WM offsets and ids are I32, which the host must check before passing a JS number in.
const isI32 = (value: number) =>
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

// Existing compiler is a bootstrap dependency. Preview execution belongs to the WM core.
export async function loadPreview() {
  const path = await Deno.makeTempFile({ suffix: ".mjs" });
  try {
    await Deno.writeTextFile(
      path,
      await compileLibraryFile(
        new URL("./preview.wm", import.meta.url).pathname,
      ),
    );
    const runtime = await import(`file://${path}`);
    // Reuse actual constructor identities, as in lexer raw-unit transport.
    const cons = runtime.units(runtime.source(" ")) as Variant;
    const nil = (cons.args[0] as [number, Variant])[1];
    const hints = (items: Insertion[]) =>
      items.reduceRight<Variant>((tail, item) => {
        if (!isI32(item.id) || !isI32(item.anchor)) {
          throw new RangeError(`Invalid UTF-16 anchor ${item.anchor} for insertion ${item.id}`);
        }
        return { ...cons, args: [[[item.id, item.anchor, item.text], tail]] };
      }, nil);
    const decode = (result: Variant): Preview => {
      if (result.name === "Err") {
        const error = result.args[0] as Variant;
        const [id, anchor] = error.args[0] as [number, number];
        throw new RangeError(`Invalid UTF-16 anchor ${anchor} for insertion ${id}`);
      }
      if (result.name !== "Ok") throw new Error("Invalid WM preview result");
      const value = result.args[0] as { rendered: unknown; placements: Variant };
      const units = list<number>(runtime.units(value.rendered));
      return {
        text: units.map((unit) => String.fromCharCode(unit)).join(""),
        units,
        placements: list<any>(value.placements).map((placement) => ({
          id: placement.insertion.insertionId,
          anchor: placement.insertion.anchor,
          text: list<number>(runtime.units(placement.insertion.content))
            .map((unit) => String.fromCharCode(unit)).join(""),
          position: placement.position,
          previewStart: placement.previewStart,
          previewEnd: placement.previewEnd,
        })),
        hints: list<any>(runtime.inlineHints(value)).map((hint) => ({
          position: { line: hint.position.line, character: hint.position.col },
          label: list<number>(runtime.units(hint.label))
            .map((unit) => String.fromCharCode(unit)).join(""),
          paddingLeft: hint.paddingLeft,
          paddingRight: hint.paddingRight,
          data: { insertionId: hint.insertionId, sourceOffset: hint.position.index },
        })),
      };
    };
    const render = (original: string, insertions: Insertion[], marked = false): Preview =>
      decode(runtime.render([original, hints(insertions), marked]));
    return Object.assign(render, {
      compare(original: string, projected: string, marked = false, limit = 256): Difference {
        if (!isI32(limit)) throw new RangeError("Diff limit must be an integer from 0 to 4096");
        const result = runtime.compare([original, projected, limit]) as Variant;
        if (result.name === "Err") {
          const error = result.args[0] as Variant;
          throw new RangeError(
            error.name === "InvalidLimit"
              ? "Diff limit must be an integer from 0 to 4096"
              : `Projection diff exceeded edit-distance limit ${limit}`,
          );
        }
        if (result.name !== "Ok") throw new Error("Invalid WM diff result");
        const difference = result.args[0] as { edits: Variant };
        return {
          ...decode(runtime.renderDifference([difference, marked])),
          projected,
          edits: list<any>(difference.edits).map((edit) => ({
            kind: edit.kind.name,
            originalStart: edit.originalStart,
            originalEnd: edit.originalEnd,
            projectedStart: edit.projectedStart,
            projectedEnd: edit.projectedEnd,
          })),
        };
      },
    });
  } finally {
    await Deno.remove(path);
  }
}
