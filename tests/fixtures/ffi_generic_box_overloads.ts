import { type Box, map } from "./ffi_generic_box.ts";

export function select(kind: "number"): Box<number>;
export function select(kind: "string"): Box<string>;
export function select(kind: "number" | "string"): Box<number> | Box<string> {
  return kind === "number" ? { value: 42 } : { value: "hello" };
}

export function transform<A, B>(f: (value: A) => B): (self: Box<A>) => Box<B>;
export function transform<A, B>(self: Box<A>, f: (value: A) => B): Box<B>;
export function transform<A, B>(
  self: Box<A> | ((value: A) => B),
  f?: (value: A) => B,
): Box<B> | ((self: Box<A>) => Box<B>) {
  if (typeof self === "function") return (box) => map(box, self);
  return map(self, f!);
}
