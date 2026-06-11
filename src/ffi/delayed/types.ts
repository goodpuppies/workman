import type { JsTypeRef } from "../reflect/types.ts";

export type ResolveOptions = {
  foreignTypeRefs?: Map<string, JsTypeRef>;
};
