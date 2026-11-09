export type Setter<S> = (next: S | ((previous: S) => S)) => void;
export function state<S>(initial: S): [S, Setter<S>, () => S] {
  let value = initial;
  return [initial, (next) => {
    value = typeof next === "function" ? (next as (previous: S) => S)(value) : next;
  }, () => value];
}
export interface Convert {
  (value: number): string;
  (value: string): number;
}
export function converter(): Convert {
  return ((value: number | string) =>
    typeof value === "number" ? String(value) : value.length) as Convert;
}
export function identityFactory(): <T>(value: T) => T {
  return (value) => value;
}
export function throwingSetter(): Setter<number> {
  return () => {
    throw new Error("setter failed");
  };
}
export function scalarConsumer(): (value: number | string) => string {
  return (value) => String(value);
}
export function optionalConsumer(): (value?: number) => number {
  return (value = 0) => value;
}
export function restConsumer(): (...values: number[]) => number {
  return (...values) => values.length;
}
export function ambiguousResult(): (value: number | string) => number | string {
  return (value) => value;
}

export function setterFactory(): (initial: number | string) => Setter<number> {
  return () => (next) => {
    void next;
  };
}
