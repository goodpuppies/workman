// Primitives of `host/js/bytes.wm`: whole-file and ranged binary IO through Deno. Each returns a
// promise of whatever the callbacks build, so this file doesn't depend on how the compiler
// represents `Result` or `Js.Error`: `ok` gets the result, `failed` the error message, and
// `unknown` stands for an error without one.

const vectorData = Symbol.for("wm.Word8Vector.data");

const wrap = (bytes) => Object.freeze({ [vectorData]: bytes });

const bytesOf = (vector) => {
  const bytes = vector?.[vectorData];
  if (!(bytes instanceof Uint8Array)) throw new TypeError("expected Word8Vector.Vector");
  return bytes;
};

const fail = (name, message) => {
  const error = new Error(message);
  error.name = name;
  throw error;
};

const settle = async (operation, ok, failed, unknown) => {
  try {
    return ok(await operation());
  } catch (error) {
    if (error instanceof Error) return failed(String(error.message));
    if (typeof error === "string") return failed(error);
    if (error && typeof error === "object" && "message" in error) {
      return failed(String(error.message));
    }
    return unknown;
  }
};

export const readFile = (path, ok, failed, unknown) =>
  settle(async () => wrap(await Deno.readFile(path)), ok, failed, unknown);

export const readSlice = (path, offset, length, ok, failed, unknown) =>
  settle(
    async () => {
      if (!Number.isSafeInteger(offset) || offset < 0) {
        fail("Domain", "offset must be a non-negative safe integer");
      }
      if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) {
        fail("Size", "length must be an integer between 0 and 4294967295");
      }
      const file = await Deno.open(path, { read: true });
      try {
        await file.seek(offset, Deno.SeekMode.Start);
        const bytes = new Uint8Array(length);
        let filled = 0;
        while (filled < length) {
          const count = await file.read(bytes.subarray(filled));
          if (count === null) {
            fail("UnexpectedEof", "short binary slice at " + offset + ": " + filled + "/" + length);
          }
          filled += count;
        }
        return wrap(bytes);
      } finally {
        file.close();
      }
    },
    ok,
    failed,
    unknown,
  );

export const writeFile = (path, vector, ok, failed, unknown) =>
  settle(
    async () => {
      await Deno.writeFile(path, bytesOf(vector));
    },
    ok,
    failed,
    unknown,
  );
