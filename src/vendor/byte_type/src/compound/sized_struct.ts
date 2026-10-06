import { type InnerType, type Options, SizedType } from "../mod.ts";
import {
  calculateFieldOffsets,
  calculatePackedFieldOffsets,
  calculateStructSize,
  calculateTotalSize,
  getBiggestAlignment,
} from "../util.ts";

type ReadFn<R> = (dt: DataView, options: Options) => R;
type WriteFn<V> = (dt: DataView, options: Options, value: V) => void;

const createRead = (key: string, method: string) =>
  `"${key}": ${key}.${method}(dt, options)`;

const createWrite = (key: string, method: string) =>
  `${key}.${method}(inputValue.${key}, dt, options);`;

function createFunc<V, M extends `read${string}`>(
  input: Record<string, SizedType<unknown>>,
  method: M,
  fieldOffsets: Record<string, number>,
): ReadFn<V>;
function createFunc<V, M extends `write${string}`>(
  input: Record<string, SizedType<unknown>>,
  method: M,
  fieldOffsets: Record<string, number>,
): WriteFn<V>;
function createFunc<V>(
  input: Record<string, SizedType<unknown>>,
  method: string,
  fieldOffsets: Record<string, number>,
): WriteFn<V> | ReadFn<V> {
  const isWriter = method.startsWith("write");
  const separator = !isWriter ? "," : "";
  const keys = Object.keys(input);

  const mapFn = isWriter
    ? (k: string) =>
      `${k}.${method}(inputValue.${k}, dt, { ...options, byteOffset: options.byteOffset + ${
        fieldOffsets[k]
      } });`
    : (k: string) =>
      `"${k}": ${k}.${method}(dt, { ...options, byteOffset: options.byteOffset + ${
        fieldOffsets[k]
      } })`;

  const generatedCodec = keys.map(mapFn).join(separator);
  const args = ["dt", "options"];
  let body = `const { ${keys} } = this;`;

  if (!isWriter) {
    body += `return {${generatedCodec}}`;
  } else {
    body += `${generatedCodec}`;
    args.push("inputValue");
  }

  args.push(body);
  return Function(...args).bind(input) as WriteFn<V> | ReadFn<V>;
}

export class SizedStruct<
  T extends Record<string, SizedType<unknown>>,
  V extends object = {
    [K in keyof T]: InnerType<T[K]>;
  },
> extends SizedType<V> {
  #readPacked: ReadFn<V>;
  #read: ReadFn<V>;
  #writePacked: WriteFn<V>;
  #write: WriteFn<V>;
  #fieldOffsets: Record<string, number>;
  #fields: T;
  #packedSize: number;

  constructor(input: T, readonly defaults: Partial<V> = {}) {
    const structSize = calculateStructSize(input);
    const structAlignment = getBiggestAlignment(input);
    super(structSize, structAlignment);

    this.#fieldOffsets = calculateFieldOffsets(input);
    this.#fields = input;
    this.#packedSize = calculateTotalSize(input);

    const packedFieldOffsets = calculatePackedFieldOffsets(input);
    this.#readPacked = createFunc(input, "readPacked", packedFieldOffsets);
    this.#read = createFunc(input, "read", this.#fieldOffsets);
    this.#writePacked = createFunc(input, "writePacked", packedFieldOffsets);
    this.#write = createFunc(input, "write", this.#fieldOffsets);
  }

  getFieldOffsets(prefix: string = ""): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, field] of Object.entries(this.#fields)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const offset = this.#fieldOffsets[key];
      result[fullKey] = offset;

      if (field instanceof SizedStruct) {
        const nestedOffsets = field.getFieldOffsets(fullKey);
        for (const [nestedKey, nestedOffset] of Object.entries(nestedOffsets)) {
          result[nestedKey] = offset + nestedOffset;
        }
      }
    }
    return result;
  }

  readPacked(dt: DataView, options: Options = { byteOffset: 0 }): V {
    if (this.#packedSize > dt.byteLength - options.byteOffset) {
      throw new RangeError("Out of bound");
    }
    const result = this.#readPacked(dt, options);
    options.byteOffset += this.#packedSize;
    return result;
  }

  override read(dt: DataView, options: Options = { byteOffset: 0 }): V {
    this.alignOffset(options);
    this.rangeCheck(dt.byteLength, options.byteOffset);
    const result = this.#read(dt, options);
    this.incrementOffset(options);
    return result;
  }

  writePacked(
    value: V,
    dt: DataView,
    options: Options = { byteOffset: 0 },
  ): void {
    if (this.#packedSize > dt.byteLength - options.byteOffset) {
      throw new RangeError("Out of bound");
    }
    this.#writePacked(dt, options, value);
    options.byteOffset += this.#packedSize;
  }

  override write(
    value: V,
    dt: DataView,
    options: Options = { byteOffset: 0 },
  ): void {
    this.alignOffset(options);
    this.rangeCheck(dt.byteLength, options.byteOffset);
    this.#write(dt, options, value);
    this.incrementOffset(options);
  }

  /** Writes only supplied fields, leaving all other bytes unchanged. */
  writePartial(
    value: Partial<V>,
    dt: DataView,
    options: Options = { byteOffset: 0 },
  ): void {
    this.alignOffset(options);
    this.rangeCheck(dt.byteLength, options.byteOffset);
    for (const key of Object.keys(value) as Array<keyof T & keyof V>) {
      const fieldValue = value[key];
      if (fieldValue === undefined) continue;
      this.#fields[key].write(
        fieldValue,
        dt,
        { ...options, byteOffset: options.byteOffset + this.#fieldOffsets[key as string] },
      );
    }
    this.incrementOffset(options);
  }
}

/** Creates a struct codec whose public value type is an existing interface. */
export function createSizedStruct<
  V extends object,
  T extends { [K in keyof V]: SizedType<any> } = { [K in keyof V]: SizedType<any> },
>(input: T, defaults: Partial<V> = {}): SizedStruct<T, V> {
  return new SizedStruct<T, V>(input, defaults);
}
