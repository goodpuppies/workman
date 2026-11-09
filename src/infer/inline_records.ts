import { prune, type RecordFieldInfo, type Ty } from "../types.ts";

/** Compare declaration templates exactly; unification would incorrectly specialize generics. */
export function assertInlineRecordFields(
  name: string,
  fields: RecordFieldInfo[],
  expected: RecordFieldInfo[],
): void {
  const required = new Map(expected.map((field) => [field.name, field.type]));
  if (fields.length !== expected.length || fields.some((field) => !required.has(field.name))) {
    throw new Error(`inline record ${name} does not match the existing record's fields`);
  }
  for (const field of fields) {
    if (!sameType(field.type, required.get(field.name)!)) {
      throw new Error(`inline record ${name} has a conflicting type for field ${field.name}`);
    }
  }
}

function sameType(left: Ty, right: Ty): boolean {
  const a = prune(left);
  const b = prune(right);
  if (a.tag !== b.tag) return false;
  const sameList = (xs: Ty[], ys: Ty[]) =>
    xs.length === ys.length && xs.every((x, index) => sameType(x, ys[index]));
  switch (a.tag) {
    case "prim":
      return b.tag === "prim" && a.name === b.name;
    case "var":
      return b.tag === "var" && a.id === b.id;
    case "ffi":
      return b.tag === "ffi" && a.id === b.id;
    case "named":
      return b.tag === "named" && a.id === b.id && sameList(a.args, b.args);
    case "tuple":
      return b.tag === "tuple" && sameList(a.items, b.items);
    case "fn":
      return b.tag === "fn" && sameList(a.params, b.params) && sameType(a.result, b.result);
    case "struct":
      return b.tag === "struct" && a.fields.length === b.fields.length &&
        a.fields.every((field, index) =>
          field.name === b.fields[index].name && sameType(field.type, b.fields[index].type)
        );
  }
}
