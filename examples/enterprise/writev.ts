/**
 * A Zig-0.16-shaped buffered writer for Deno, implemented by hand-assembling
 * `struct iovec[]` in a Uint8Array and calling libc `writev(2)` over FFI.
 *
 * ABI assumption: 64-bit little-endian Linux (pointer and size_t are 8 bytes).
 *
 *   struct iovec {
 *       void   *iov_base;  // +0, 8 bytes
 *       size_t  iov_len;   // +8, 8 bytes
 *   };
 */

const IOVEC_SIZE = 16;

const libc = Deno.dlopen("libc.so.6", {
  writev: {
    parameters: [
      "i32", // int fd
      "buffer", // const struct iovec *iov
      "i32", // int iovcnt
    ],
    result: "isize",
  },
  __errno_location: { parameters: [], result: "pointer" },
} as const);

const encoder = new TextEncoder();

function errno(): number {
  const p = libc.symbols.__errno_location();
  if (p === null) return 0;
  return new Deno.UnsafePointerView(p).getInt32(0);
}

const EINTR = 4;
const EAGAIN = 11;

function addressOf(view: Uint8Array): bigint {
  const pointer = Deno.UnsafePointer.of(view);
  if (pointer === null) throw new Error("couldn't acquire buffer pointer");
  return Deno.UnsafePointer.value(pointer) as bigint;
}

/** One vectored write, retrying on EINTR/EAGAIN and advancing across partial writes. */
function writevAll(fd: number, buffers: Uint8Array[]): void {
  // Only keep non-empty slices; writev on a zero-length iovec is legal but wasteful.
  let pending = buffers.filter((b) => b.byteLength > 0);

  while (pending.length > 0) {
    const iovecs = new Uint8Array(IOVEC_SIZE * pending.length);
    const struct = new DataView(iovecs.buffer);

    for (let i = 0; i < pending.length; i++) {
      const base = i * IOVEC_SIZE;
      struct.setBigUint64(base + 0, addressOf(pending[i]), true); // iov_base
      struct.setBigUint64(base + 8, BigInt(pending[i].byteLength), true); // iov_len
    }

    // `pending` is still referenced here, so the backing stores stay alive
    // while the raw pointers inside `iovecs` are in flight.
    const n = libc.symbols.writev(fd, iovecs, pending.length) as bigint;

    if (n < 0n) {
      const e = errno();
      if (e === EINTR || e === EAGAIN) continue;
      throw new Error(`writev failed: errno ${e}`);
    }

    // Advance across the iovecs by however many bytes actually landed.
    let remaining = n;
    let i = 0;
    while (i < pending.length && remaining >= BigInt(pending[i].byteLength)) {
      remaining -= BigInt(pending[i].byteLength);
      i++;
    }
    if (i < pending.length && remaining > 0n) {
      pending[i] = pending[i].subarray(Number(remaining));
    }
    pending = pending.slice(i);
  }
}

/** The `*Writer` interface: a fixed userspace buffer plus an explicit drain. */
export class Writer {
  #fd: number;
  #buffer: Uint8Array;
  #end = 0;

  constructor(fd: number, buffer: Uint8Array) {
    this.#fd = fd;
    this.#buffer = buffer;
  }

  get buffered(): number {
    return this.#end;
  }

  /** Append raw bytes, draining as needed. Data larger than the buffer bypasses it. */
  writeAll(bytes: Uint8Array): void {
    if (bytes.byteLength > this.#buffer.length - this.#end) {
      // Drain what we have and the oversized payload in a single vectored write.
      if (this.#end > 0) {
        writevAll(this.#fd, [this.#buffer.subarray(0, this.#end), bytes]);
        this.#end = 0;
      } else {
        writevAll(this.#fd, [bytes]);
      }
      return;
    }
    this.#buffer.set(bytes, this.#end);
    this.#end += bytes.byteLength;
  }

  /** `print("{s}\n", .{x})`-ish: template-free, just formatted text. */
  print(text: string): void {
    this.writeAll(encoder.encode(text));
  }

  /** Hand the userspace buffer to writev(2). No-op when empty. */
  flush(): void {
    if (this.#end === 0) return;
    const data = this.#buffer.subarray(0, this.#end);
    this.#end = 0;
    writevAll(this.#fd, [data]);
  }
}

/** `std.Io.File` stand-in. */
export class File {
  readonly fd: number;

  constructor(fd: number) {
    this.fd = fd;
  }

  static stdout(): File {
    return new File(1);
  }

  static stderr(): File {
    return new File(2);
  }

  /** Mirrors `file.writer(io, &buf)`; the returned object exposes `.interface`. */
  writer(buffer: Uint8Array): { interface: Writer } {
    return { interface: new Writer(this.fd, buffer) };
  }
}

export function close(): void {
  libc.close();
}
