export interface FfiEntry {
  path: string;
}

export function makeIterator(): IterableIterator<FfiEntry> {
  return [{ path: "one.wm" }][Symbol.iterator]();
}
