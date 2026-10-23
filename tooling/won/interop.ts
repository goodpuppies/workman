/** Small translations for the current WM JS backend. No alternate WON parser.
 * Constructor numbers are bundle-local; only names and payloads are inspected.
 * Records stay lists of key/value pairs, never coerced to JS objects.
 */
export type WmList<T> =
  | { name: "Nil"; args: [] }
  | { name: "Cons"; args: [[T, WmList<T>]] };
export type WmResult<T, E> =
  | { name: "Ok"; args: [T] }
  | { name: "Err"; args: [E] };
/** `message` is a UTF-8 byte string; `offset` counts bytes from zero. */
export type DecodeError = { offset: number; message: string };
export type Fields = WmList<[string, Value]>;
export type Value =
  | { name: "Null"; args: [] }
  | { name: "Boolean"; args: [boolean] }
  | { name: "Number"; args: [string] }
  | { name: "Text"; args: [string] }
  | { name: "Blob"; args: [WmList<string>] }
  | { name: "List"; args: [WmList<Value>] }
  | { name: "Record"; args: [Fields] }
  | { name: "Tag"; args: [[string, Fields, Value]] };

export function listToArray<T>(list: WmList<T>): T[] {
  const result: T[] = [];
  while (list.name === "Cons") {
    const [head, tail] = list.args[0];
    result.push(head);
    list = tail;
  }
  return result;
}

export function resultToJS<T, E>(
  result: WmResult<T, E>,
): { ok: true; value: T } | { ok: false; error: E } {
  return result.name === "Ok"
    ? { ok: true, value: result.args[0] }
    : { ok: false, error: result.args[0] };
}

/** Byte strings carry octets, not JS Unicode text. */
export function bytesToString(bytes: Uint8Array): string {
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 4096)));
  }
  return pieces.join("");
}

export function stringToBytes(bytes: string): Uint8Array {
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes.charCodeAt(i);
    if (code > 255) throw new TypeError("expected a WM byte string");
    result[i] = code;
  }
  return result;
}

export function decodeText(bytes: string): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stringToBytes(bytes));
}

export type WonModule = {
  decode: (source: string) => WmResult<Value, DecodeError>;
  encode: (value: Value) => WmResult<string, string>;
};

export class WonSyntaxError extends Error {
  constructor(readonly offset: number, readonly reason: string) {
    super(`byte ${offset}: ${reason}`);
    this.name = "WonSyntaxError";
  }
}

/** `expected` is undefined when the path is missing rather than mismatched. */
export class WonAccessError extends Error {
  constructor(readonly path: string, readonly expected?: string) {
    super(expected === undefined ? `${path}: missing` : `${path}: expected ${expected}`);
    this.name = "WonAccessError";
  }
}

/** JSON-like entry points over a compiled WM `won.mjs`: `bind(await import(".../won.mjs"))`. */
export function bind(won: WonModule) {
  return {
    parse(source: string | Uint8Array): Found {
      const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
      const result = resultToJS(won.decode(bytesToString(bytes)));
      if (!result.ok) throw new WonSyntaxError(result.error.offset, decodeText(result.error.message));
      return Found.root(result.value);
    },
    stringify(value: Value | Found): string {
      const result = resultToJS(won.encode(value instanceof Found ? value.value() : value));
      if (!result.ok) throw new TypeError(decodeText(result.error));
      return decodeText(result.value);
    },
  };
}

// Paths match the WM accessors: `server.port`, `items[1]`, `view<id>`, `"odd key"`.
function keyText(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return key;
  const named: Record<string, string> = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
  return `"${
    key.replace(/["\\\x00-\x1f\x7f]/g, (c) =>
      named[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
  }"`;
}

function keyStep(path: string[], key: string): string[] {
  return path.length === 0 ? [keyText(key)] : [...path, "." + keyText(key)];
}

function pathText(path: string[]): string {
  return path.length === 0 ? "document" : path.join("");
}

type State = { value: Value; path: string[] } | { error: WonAccessError };

function lookup(fields: Fields, key: string, path: string[]): State {
  const entry = listToArray(fields).find(([name]) => decodeText(name) === key);
  return entry ? { value: entry[1], path } : { error: new WonAccessError(pathText(path)) };
}

/** One step of an access chain. Problems surface only when the chain is read. */
export class Found {
  private constructor(private readonly state: State) {}

  static root(value: Value): Found {
    return new Found({ value, path: [] });
  }

  private then(kind: string, step: (value: Value, path: string[]) => State | undefined): Found {
    if ("error" in this.state) return this;
    const { value, path } = this.state;
    return new Found(step(value, path) ?? { error: new WonAccessError(pathText(path), kind) });
  }

  private read<T>(kind: string, extract: (value: Value) => T | undefined): T {
    if ("error" in this.state) throw this.state.error;
    const result = extract(this.state.value);
    if (result === undefined) throw new WonAccessError(pathText(this.state.path), kind);
    return result;
  }

  get(key: string): Found {
    return this.then("record", (value, path) =>
      value.name === "Record"
        ? lookup(value.args[0], key, keyStep(path, key))
        : undefined);
  }

  attribute(key: string): Found {
    return this.then("tag", (value, path) =>
      value.name === "Tag" ? lookup(value.args[0][1], key, [...path, `<${keyText(key)}>`]) : undefined);
  }

  index(position: number): Found {
    return this.then("list", (value, path) => {
      if (value.name !== "List") return undefined;
      const item = listToArray(value.args[0])[position];
      const at = [...path, `[${position}]`];
      return item ? { value: item, path: at } : { error: new WonAccessError(pathText(at)) };
    });
  }

  /** A tag's payload keeps the tag's path. */
  payload(): Found {
    return this.then("tag", (value, path) =>
      value.name === "Tag" ? { value: value.args[0][2], path } : undefined);
  }

  /** Ends a chain: undefined if anything along it was missing; mismatches still throw. */
  optional(): Found | undefined {
    if ("error" in this.state && this.state.error.expected === undefined) return undefined;
    this.read("value", (value) => value);
    return this;
  }

  value(): Value {
    return this.read("value", (value) => value);
  }

  tagName(): string {
    return this.read("tag", (value) => value.name === "Tag" ? decodeText(value.args[0][0]) : undefined);
  }

  items(): Found[] {
    const values = this.read("list", (value) => value.name === "List" ? listToArray(value.args[0]) : undefined);
    const path = (this.state as { path: string[] }).path;
    return values.map((value, i) => new Found({ value, path: [...path, `[${i}]`] }));
  }

  entries(): [string, Found][] {
    const fields = this.read("record", (value) => value.name === "Record" ? listToArray(value.args[0]) : undefined);
    const path = (this.state as { path: string[] }).path;
    return fields.map(([name, value]) => {
      const key = decodeText(name);
      return [key, new Found({ value, path: keyStep(path, key) })];
    });
  }

  text(): string {
    return this.read("text", (value) => value.name === "Text" ? decodeText(value.args[0]) : undefined);
  }

  /** The exact spelling; numeric conversion is the caller's choice. */
  number(): string {
    return this.read("number", (value) => value.name === "Number" ? value.args[0] : undefined);
  }

  boolean(): boolean {
    return this.read("boolean", (value) => value.name === "Boolean" ? value.args[0] : undefined);
  }

  blob(): Uint8Array {
    return this.read("blob", (value) =>
      value.name === "Blob" ? stringToBytes(listToArray(value.args[0]).join("")) : undefined);
  }
}
