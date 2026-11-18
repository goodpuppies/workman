import type { AuditableDiagnostic } from "../diagnostic_writer.ts";
import type { DiffPath } from "../type_diff.ts";
import { typeSnapshotRendered } from "./rendering.ts";

/** Shorten surrounding structure, retaining the exact type at the conflicting signature slot. */
export function focusedSignature(
  diagnostic: AuditableDiagnostic,
  type: string,
  path: DiffPath,
  width: number,
): string {
  const full = typeSnapshotRendered(diagnostic, type);
  if (full.length <= width || path.length === 0) return full;
  const shape = diagnostic.support.types.find((snapshot) => snapshot.id === type)?.shape;
  const [slot, ...rest] = path;
  const focus = (child: string, overhead: number) =>
    focusedSignature(diagnostic, child, rest, Math.max(0, width - overhead));
  switch (slot.kind) {
    case "fn-param":
      if (shape?.kind === "function" && shape.params[slot.index]) {
        return `${focus(shape.params[slot.index], 6)} -> ..`;
      }
      break;
    case "fn-result":
      if (shape?.kind === "function") return `.. -> ${focus(shape.result, 6)}`;
      break;
    case "tuple-item":
      if (shape?.kind === "tuple" && shape.items[slot.index]) {
        const before = slot.index > 0 ? ".., " : "";
        const after = slot.index < shape.items.length - 1 ? ", .." : "";
        return `(${before}${
          focus(shape.items[slot.index], before.length + after.length + 2)
        }${after})`;
      }
      break;
    case "named-arg":
      if (shape?.kind === "named" && shape.args[slot.index]) {
        const name = full.split("<", 1)[0];
        const before = slot.index > 0 ? ".., " : "";
        const after = slot.index < shape.args.length - 1 ? ", .." : "";
        return `${name}<${before}${
          focus(shape.args[slot.index], name.length + before.length + after.length + 2)
        }${after}>`;
      }
      break;
    case "record-field": {
      const field = shape?.kind === "struct"
        ? shape.fields.find((field) => field.name === slot.name)
        : undefined;
      if (field) return `{ .., ${field.name}: ${focus(field.type, field.name.length + 12)}, .. }`;
      break;
    }
  }
  return full;
}
