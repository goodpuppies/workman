import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { API, type APIOptions } from "tsrs/sync";
import { runtime } from "../../io.ts";

const MSG_REQUEST = 1;
const MSG_CALL_RESPONSE = 2;
const MSG_CALL_ERROR = 3;
const MSG_RESPONSE = 4;
const MSG_ERROR = 5;
const MSG_CALL = 6;

// SharedArrayBuffer layout:
// Int32Array header (8 * 4 = 32 bytes):
//   [0] state:
//       0 = idle
//       1 = main -> worker chunk ready
//       2 = worker -> main chunk ready
//       3 = worker acked main chunk
//       4 = main acked worker chunk
//       5 = worker fatal error (payload holds UTF-8 message)
//       6 = close request
//   [1] msgType
//   [2] nameLen (set on first chunk of a message)
//   [3] totalPayloadLen (set on first chunk of a message)
//   [4] chunkLen (bytes in data section for this chunk)
//   [5] isLastChunk (1 if final chunk of this message, else 0)
const HEADER_INTS = 8;
const HEADER_BYTES = HEADER_INTS * 4;
const SAB_BYTES = 1024 * 1024; // 1 MiB chunk buffer
const MAX_CHUNK_BYTES = SAB_BYTES - HEADER_BYTES;

const STATE_IDLE = 0;
const STATE_M2W = 1;
const STATE_W2M = 2;
const STATE_W_ACK = 3;
const STATE_M_ACK = 4;
const STATE_FATAL = 5;
const STATE_CLOSE = 6;

const WORKER_SCRIPT = String.raw`
const { workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");

const { sab, exe, args } = workerData;
const header = new Int32Array(sab, 0, ${HEADER_INTS});
const dataView = new Uint8Array(sab, ${HEADER_BYTES});

const HEADER_BYTES = ${HEADER_BYTES};
const MAX_CHUNK_BYTES = ${MAX_CHUNK_BYTES};
const STATE_IDLE = ${STATE_IDLE};
const STATE_M2W = ${STATE_M2W};
const STATE_W2M = ${STATE_W2M};
const STATE_W_ACK = ${STATE_W_ACK};
const STATE_M_ACK = ${STATE_M_ACK};
const STATE_FATAL = ${STATE_FATAL};
const STATE_CLOSE = ${STATE_CLOSE};

const MSGPACK_FIXARRAY3 = 0x93;
const MSGPACK_UINT8 = 0xcc;
const MSGPACK_BIN8 = 0xc4;
const MSGPACK_BIN16 = 0xc5;
const MSGPACK_BIN32 = 0xc6;

function binHeaderSize(len) {
  if (len <= 0xff) return 2;
  if (len <= 0xffff) return 3;
  return 5;
}

function writeBinHeader(buf, offset, len) {
  if (len <= 0xff) {
    buf[offset] = MSGPACK_BIN8;
    buf[offset + 1] = len;
    return offset + 2;
  }
  if (len <= 0xffff) {
    buf[offset] = MSGPACK_BIN16;
    buf[offset + 1] = (len >>> 8) & 0xff;
    buf[offset + 2] = len & 0xff;
    return offset + 3;
  }
  buf[offset] = MSGPACK_BIN32;
  buf[offset + 1] = (len >>> 24) & 0xff;
  buf[offset + 2] = (len >>> 16) & 0xff;
  buf[offset + 3] = (len >>> 8) & 0xff;
  buf[offset + 4] = len & 0xff;
  return offset + 5;
}

function encodeTuple(type, nameBytes, payloadBytes) {
  const total = 2 + binHeaderSize(nameBytes.length) + nameBytes.length +
    binHeaderSize(payloadBytes.length) + payloadBytes.length;
  const out = Buffer.allocUnsafe(total);
  let off = 0;
  out[off++] = MSGPACK_FIXARRAY3;
  out[off++] = type;
  off = writeBinHeader(out, off, nameBytes.length);
  nameBytes.copy(out, off);
  off += nameBytes.length;
  off = writeBinHeader(out, off, payloadBytes.length);
  payloadBytes.copy(out, off);
  return out;
}

const child = spawn(exe, args, { stdio: ["pipe", "pipe", "inherit"] });

let readBuffer = Buffer.alloc(0);
let readWaiters = [];
let childEnded = false;
let childError = null;

function notifyReadWaiters() {
  const waiters = readWaiters;
  readWaiters = [];
  for (const w of waiters) w();
}

child.stdout.on("data", (chunk) => {
  readBuffer = readBuffer.length === 0 ? chunk : Buffer.concat([readBuffer, chunk]);
  notifyReadWaiters();
});
child.stdout.on("end", () => {
  childEnded = true;
  notifyReadWaiters();
});
child.on("error", (err) => {
  childError = err;
  childEnded = true;
  notifyReadWaiters();
});
child.on("exit", (code, signal) => {
  if (!childError && code !== 0 && code !== null) {
    childError = new Error("tsrs API process exited with code " + code);
  } else if (!childError && signal) {
    childError = new Error("tsrs API process killed by signal " + signal);
  }
  childEnded = true;
  notifyReadWaiters();
});

async function ensureBytes(n) {
  while (readBuffer.length < n) {
    if (childEnded) {
      throw childError ?? new Error("Unexpected EOF reading from tsrs API process");
    }
    await new Promise((resolve) => readWaiters.push(resolve));
  }
}

async function readExact(n) {
  await ensureBytes(n);
  const out = readBuffer.subarray(0, n);
  readBuffer = readBuffer.subarray(n);
  return out;
}

async function readByte() {
  await ensureBytes(1);
  const b = readBuffer[0];
  readBuffer = readBuffer.subarray(1);
  return b;
}

async function readBin() {
  const tag = await readByte();
  let len;
  if (tag === MSGPACK_BIN8) {
    len = await readByte();
  } else if (tag === MSGPACK_BIN16) {
    const b = await readExact(2);
    len = (b[0] << 8) | b[1];
  } else if (tag === MSGPACK_BIN32) {
    const b = await readExact(4);
    len = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  } else {
    throw new Error("Expected msgpack bin tag, got 0x" + tag.toString(16));
  }
  return len === 0 ? Buffer.alloc(0) : await readExact(len);
}

async function readTupleFromChild() {
  const arr = await readByte();
  if (arr !== MSGPACK_FIXARRAY3) {
    throw new Error("Expected msgpack fixarray(3), got 0x" + arr.toString(16));
  }
  let type = await readByte();
  if (type === MSGPACK_UINT8) {
    type = await readByte();
  }
  const name = await readBin();
  const payload = await readBin();
  return { type, name, payload };
}

function sendFatal(err) {
  const msg = Buffer.from(String(err instanceof Error ? err.message : err), "utf-8");
  const len = Math.min(msg.length, MAX_CHUNK_BYTES);
  dataView.set(msg.subarray(0, len), 0);
  Atomics.store(header, 4, len);
  Atomics.store(header, 0, STATE_FATAL);
  Atomics.notify(header, 0);
}

function waitForMainState(fromState) {
  // Block asynchronously using Atomics.waitAsync if available, else Atomics.wait
  // Inside a dedicated worker thread, Atomics.wait is completely safe and fast!
  while (true) {
    const cur = Atomics.load(header, 0);
    if (cur !== fromState) return cur;
    Atomics.wait(header, 0, fromState);
  }
}

function receiveMessageFromMain() {
  let state = waitForMainState(STATE_IDLE);
  if (state === STATE_CLOSE) return null;
  if (state !== STATE_M2W) throw new Error("Unexpected state from main: " + state);
  const type = Atomics.load(header, 1);
  const nameLen = Atomics.load(header, 2);
  const totalPayloadLen = Atomics.load(header, 3);
  let chunkLen = Atomics.load(header, 4);
  let isLast = Atomics.load(header, 5) === 1;

  const name = Buffer.from(dataView.subarray(0, nameLen));
  const payload = Buffer.allocUnsafe(totalPayloadLen);
  const firstPayloadLen = chunkLen - nameLen;
  if (firstPayloadLen > 0) {
    payload.set(dataView.subarray(nameLen, chunkLen), 0);
  }
  let offset = firstPayloadLen;

  while (!isLast) {
    Atomics.store(header, 0, STATE_W_ACK);
    Atomics.notify(header, 0);
    state = waitForMainState(STATE_W_ACK);
    if (state === STATE_CLOSE) return null;
    chunkLen = Atomics.load(header, 4);
    isLast = Atomics.load(header, 5) === 1;
    payload.set(dataView.subarray(0, chunkLen), offset);
    offset += chunkLen;
  }
  return { type, name, payload };
}

function sendMessageToMain(type, name, payload) {
  const nameLen = name.length;
  const totalPayloadLen = payload.length;
  let offset = 0;
  let first = true;
  while (true) {
    let chunkEnd = 0;
    if (first) {
      dataView.set(name, 0);
      chunkEnd = nameLen;
      const room = MAX_CHUNK_BYTES - nameLen;
      const take = Math.min(room, totalPayloadLen - offset);
      if (take > 0) {
        dataView.set(payload.subarray(offset, offset + take), chunkEnd);
        chunkEnd += take;
        offset += take;
      }
      Atomics.store(header, 1, type);
      Atomics.store(header, 2, nameLen);
      Atomics.store(header, 3, totalPayloadLen);
      first = false;
    } else {
      const take = Math.min(MAX_CHUNK_BYTES, totalPayloadLen - offset);
      dataView.set(payload.subarray(offset, offset + take), 0);
      chunkEnd = take;
      offset += take;
    }
    const isLast = offset >= totalPayloadLen;
    Atomics.store(header, 4, chunkEnd);
    Atomics.store(header, 5, isLast ? 1 : 0);
    Atomics.store(header, 0, STATE_W2M);
    Atomics.notify(header, 0);
    if (isLast) {
      // Wait for main to finish reading final chunk and transition to IDLE or next M2W
      const next = waitForMainState(STATE_W2M);
      if (next === STATE_M_ACK) {
        Atomics.store(header, 0, STATE_IDLE);
        Atomics.notify(header, 0);
      }
      return;
    }
    waitForMainState(STATE_W2M);
  }
}

async function loop() {
  try {
    while (true) {
      const msg = receiveMessageFromMain();
      if (!msg) break;
      const encoded = encodeTuple(msg.type, msg.name, msg.payload);
      await new Promise((resolve, reject) => {
        child.stdin.write(encoded, (err) => (err ? reject(err) : resolve()));
      });
      if (msg.type === ${MSG_REQUEST}) {
        // After sending a request, wait for responses or nested calls from child
        while (true) {
          const reply = await readTupleFromChild();
          sendMessageToMain(reply.type, reply.name, reply.payload);
          if (reply.type === ${MSG_CALL}) {
            // Main thread will either send nested MSG_REQUEST(s) or MSG_CALL_RESPONSE / MSG_CALL_ERROR
            break;
          }
          if (reply.type === ${MSG_RESPONSE} || reply.type === ${MSG_ERROR}) {
            break;
          }
        }
      } else if (msg.type === ${MSG_CALL_RESPONSE} || msg.type === ${MSG_CALL_ERROR}) {
        // After answering a callback, continue reading the pending outer response from child
        const reply = await readTupleFromChild();
        sendMessageToMain(reply.type, reply.name, reply.payload);
      }
    }
  } catch (err) {
    sendFatal(err);
  } finally {
    try { child.stdin.destroy(); } catch {}
    try { child.stdout.destroy(); } catch {}
    try { child.kill(); } catch {}
  }
}

loop();
`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class WorkerSyncRpcChannel {
  #worker: Worker;
  #header: Int32Array;
  #dataView: Uint8Array;
  #callbacks = new Map<string, (name: string, payload: string) => string>();
  #callbackFailure: { error: unknown } | undefined;
  #closed = false;
  collectTiming: boolean;
  lastBytesSent = 0;
  lastBytesReceived = 0;

  constructor(exe: string, args: string[], collectTiming = false) {
    this.collectTiming = collectTiming;
    const sab = new SharedArrayBuffer(SAB_BYTES);
    this.#header = new Int32Array(sab, 0, HEADER_INTS);
    this.#dataView = new Uint8Array(sab, HEADER_BYTES);
    this.#worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: { sab, exe, args },
    });
    this.#worker.unref();
  }

  registerCallback(name: string, callback: (name: string, payload: string) => string): void {
    this.#callbacks.set(name, callback);
  }

  unregisterCallback(name: string): void {
    this.#callbacks.delete(name);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      Atomics.store(this.#header, 0, STATE_CLOSE);
      Atomics.notify(this.#header, 0);
      void this.#worker.terminate();
    } catch {
      // Ignore cleanup errors.
    }
  }

  requestSync(method: string, payload: string): string {
    this.#ensureOpen();
    return decoder.decode(this.#requestBytesSync(method, encoder.encode(payload)));
  }

  requestBinarySync(method: string, payload: string | Uint8Array): Uint8Array {
    this.#ensureOpen();
    const bytes = typeof payload === "string" ? encoder.encode(payload) : payload;
    return this.#requestBytesSync(method, bytes);
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("SyncRpcChannel is closed");
    if (this.#callbackFailure) throw this.#callbackFailure.error;
  }

  #waitWhile(expected: number): number {
    while (true) {
      const cur = Atomics.load(this.#header, 0);
      if (cur !== expected) return cur;
      Atomics.wait(this.#header, 0, expected);
    }
  }

  #sendMessage(type: number, nameBytes: Uint8Array, payloadBytes: Uint8Array): void {
    // Wait until worker is idle before sending a new message.
    const init = Atomics.load(this.#header, 0);
    if (init !== STATE_IDLE && init !== STATE_FATAL) {
      this.#waitWhile(init);
    }
    if (Atomics.load(this.#header, 0) === STATE_FATAL) {
      const len = Atomics.load(this.#header, 4);
      throw new Error(decoder.decode(this.#dataView.slice(0, len)));
    }

    const nameLen = nameBytes.length;
    const totalPayloadLen = payloadBytes.length;
    let offset = 0;
    let first = true;
    while (true) {
      let chunkEnd = 0;
      if (first) {
        this.#dataView.set(nameBytes, 0);
        chunkEnd = nameLen;
        const room = MAX_CHUNK_BYTES - nameLen;
        const take = Math.min(room, totalPayloadLen - offset);
        if (take > 0) {
          this.#dataView.set(payloadBytes.subarray(offset, offset + take), chunkEnd);
          chunkEnd += take;
          offset += take;
        }
        Atomics.store(this.#header, 1, type);
        Atomics.store(this.#header, 2, nameLen);
        Atomics.store(this.#header, 3, totalPayloadLen);
        first = false;
      } else {
        const take = Math.min(MAX_CHUNK_BYTES, totalPayloadLen - offset);
        this.#dataView.set(payloadBytes.subarray(offset, offset + take), 0);
        chunkEnd = take;
        offset += take;
      }
      const isLast = offset >= totalPayloadLen;
      Atomics.store(this.#header, 4, chunkEnd);
      Atomics.store(this.#header, 5, isLast ? 1 : 0);
      Atomics.store(this.#header, 0, STATE_M2W);
      Atomics.notify(this.#header, 0);
      if (isLast) return;
      const ack = this.#waitWhile(STATE_M2W);
      if (ack === STATE_FATAL) {
        const len = Atomics.load(this.#header, 4);
        throw new Error(decoder.decode(this.#dataView.slice(0, len)));
      }
    }
  }

  #receiveMessage(): { type: number; name: Uint8Array; payload: Uint8Array } {
    let state = this.#waitWhile(STATE_M2W);
    if (state === STATE_FATAL) {
      const len = Atomics.load(this.#header, 4);
      throw new Error(decoder.decode(this.#dataView.slice(0, len)));
    }
    if (state !== STATE_W2M) {
      throw new Error(`Unexpected worker state: ${state}`);
    }
    const type = Atomics.load(this.#header, 1);
    const nameLen = Atomics.load(this.#header, 2);
    const totalPayloadLen = Atomics.load(this.#header, 3);
    let chunkLen = Atomics.load(this.#header, 4);
    let isLast = Atomics.load(this.#header, 5) === 1;

    const name = this.#dataView.slice(0, nameLen);
    const payload = new Uint8Array(totalPayloadLen);
    const firstPayloadLen = chunkLen - nameLen;
    if (firstPayloadLen > 0) {
      payload.set(this.#dataView.subarray(nameLen, chunkLen), 0);
    }
    let offset = firstPayloadLen;

    while (!isLast) {
      Atomics.store(this.#header, 0, STATE_M_ACK);
      Atomics.notify(this.#header, 0);
      state = this.#waitWhile(STATE_M_ACK);
      if (state === STATE_FATAL) {
        const len = Atomics.load(this.#header, 4);
        throw new Error(decoder.decode(this.#dataView.slice(0, len)));
      }
      chunkLen = Atomics.load(this.#header, 4);
      isLast = Atomics.load(this.#header, 5) === 1;
      payload.set(this.#dataView.subarray(0, chunkLen), offset);
      offset += chunkLen;
    }

    // Acknowledge final chunk so worker resets to IDLE.
    Atomics.store(this.#header, 0, STATE_M_ACK);
    Atomics.notify(this.#header, 0);
    this.#waitWhile(STATE_M_ACK);

    return { type, name, payload };
  }

  #requestBytesSync(method: string, payloadBytes: Uint8Array): Uint8Array {
    const methodBytes = encoder.encode(method);
    if (this.collectTiming) {
      this.lastBytesSent = payloadBytes.length;
      this.lastBytesReceived = 0;
    }
    this.#sendMessage(MSG_REQUEST, methodBytes, payloadBytes);
    for (;;) {
      const reply = this.#receiveMessage();
      switch (reply.type) {
        case MSG_RESPONSE: {
          if (!bytesEqual(methodBytes, reply.name)) {
            throw new Error(
              `name mismatch for response: expected \`${method}\`, got \`${
                decoder.decode(reply.name)
              }\``,
            );
          }
          if (this.collectTiming) this.lastBytesReceived = reply.payload.length;
          return reply.payload;
        }
        case MSG_ERROR: {
          if (bytesEqual(methodBytes, reply.name)) {
            throw new Error(decoder.decode(reply.payload));
          }
          throw new Error(
            `name mismatch for response: expected \`${method}\`, got \`${
              decoder.decode(reply.name)
            }\``,
          );
        }
        case MSG_CALL: {
          try {
            this.#handleCall(decoder.decode(reply.name), reply.payload);
          } catch (error) {
            this.#callbackFailure = { error };
            throw error;
          }
          break;
        }
        default:
          throw new Error(`Invalid message type from child: ${reply.type}`);
      }
    }
  }

  #handleCall(name: string, payload: Uint8Array): void {
    const cb = this.#callbacks.get(name);
    const nameBytes = encoder.encode(name);
    if (!cb) {
      const errMsg =
        `unknown callback: \`${name}\`. Please make sure to register it on the JavaScript side before invoking it.`;
      this.#sendMessage(MSG_CALL_ERROR, nameBytes, encoder.encode(errMsg));
      throw new Error(`no callback named \`${name}\` found`);
    }
    try {
      const result = cb(name, decoder.decode(payload));
      this.#sendMessage(MSG_CALL_RESPONSE, nameBytes, encoder.encode(result));
    } catch (error) {
      const errMsg = String(error instanceof Error ? error.message : error).trim();
      this.#sendMessage(MSG_CALL_ERROR, nameBytes, encoder.encode(errMsg));
      throw new Error(`Error calling callback \`${name}\`: ${errMsg}`);
    }
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function resolveTsrsBinaryPath(): string | undefined {
  const envPath = runtime.env("WM_TSRS_PATH")?.trim() || runtime.env("TSRS_BINARY")?.trim();
  if (envPath && existsSync(envPath)) return envPath;
  const isStandalone = (globalThis as { Deno?: { build?: { standalone?: boolean } } }).Deno?.build
    ?.standalone === true;
  if (isStandalone && typeof Deno !== "undefined") {
    const exeName = Deno.build.os === "windows" ? "tsrs.exe" : "tsrs";
    const sibling = join(dirname(Deno.execPath()), exeName);
    if (existsSync(sibling)) return sibling;
  }
  return undefined;
}

/**
 * Creates a synchronous `tsrs/sync` API instance that works under Deno.
 * On POSIX under Deno, `tsrs`'s built-in `SyncRpcChannel` gets `EBADF` because
 * `child_process.spawn` pipe `_handle.fd` is a Deno resource ID rather than an OS fd.
 * Replacing `client.channel` with a `worker_threads`-backed channel preserves the exact
 * synchronous MessagePack protocol across all platforms.
 */
export function createTsrsApi(options: APIOptions = {}): API {
  const tsserverPath = options.tsserverPath ?? resolveTsrsBinaryPath();
  const apiOptions: APIOptions = tsserverPath ? { ...options, tsserverPath } : options;
  const api = new API(apiOptions);
  if (typeof Deno !== "undefined" && Deno.build.os !== "windows") {
    const internal = api as unknown as {
      client: {
        channel: {
          child?: { spawnfile?: string; spawnargs?: string[] };
          collectTiming?: boolean;
          close(): void;
        };
      };
    };
    const oldChannel = internal.client.channel;
    const exe = oldChannel.child?.spawnfile ?? tsserverPath;
    const args = oldChannel.child?.spawnargs?.slice(1) ?? ["--api", "--cwd", options.cwd ?? runtime.cwd()];
    const collectTiming = oldChannel.collectTiming ?? false;
    oldChannel.close();
    if (!exe) {
      throw new Error("Could not determine tsrs executable path for Deno sync channel");
    }
    internal.client.channel = new WorkerSyncRpcChannel(exe, args, collectTiming);
  }
  return api;
}
