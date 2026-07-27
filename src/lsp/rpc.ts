const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type RpcMessage = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type RpcDecodeError = Readonly<{
  id: number | string | null;
  code: -32700 | -32600;
  message: "parse error" | "invalid request";
}>;

export function encodeMessage(message: RpcMessage): Uint8Array {
  const body = JSON.stringify(message);
  const bytes = encoder.encode(body);
  return encoder.encode(`Content-Length: ${bytes.length}\r\n\r\n${body}`);
}

export function decodeMessages(
  buffer: Uint8Array<ArrayBufferLike>,
): {
  messages: RpcMessage[];
  errors: RpcDecodeError[];
  rest: Uint8Array<ArrayBufferLike>;
} {
  const messages: RpcMessage[] = [];
  const errors: RpcDecodeError[] = [];
  let bytes = buffer;
  while (true) {
    const headerEnd = headerEndIndex(bytes);
    if (headerEnd < 0) break;
    const header = decoder.decode(bytes.slice(0, headerEnd));
    const length = contentLength(header);
    if (length === undefined) {
      bytes = bytes.slice(headerEnd + 4);
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (bytes.length < bodyEnd) break;
    try {
      const parsed: unknown = JSON.parse(decoder.decode(bytes.slice(bodyStart, bodyEnd)));
      if (isRpcMessage(parsed)) {
        messages.push(parsed);
      } else {
        errors.push(Object.freeze({
          id: recoverRpcId(parsed),
          code: -32600,
          message: "invalid request",
        }));
      }
    } catch {
      errors.push(Object.freeze({
        id: null,
        code: -32700,
        message: "parse error",
      }));
    }
    bytes = bytes.slice(bodyEnd);
  }
  return { messages, errors, rest: bytes };
}

function isRpcMessage(value: unknown): value is RpcMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || !validRpcId(message.id)) return false;
  if ("method" in message) return typeof message.method === "string";
  return "id" in message && ("result" in message || "error" in message);
}

function recoverRpcId(value: unknown): number | string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "number" || typeof id === "string" || id === null ? id : null;
}

function validRpcId(id: unknown): boolean {
  return id === undefined || id === null || typeof id === "number" || typeof id === "string";
}

function contentLength(header: string): number | undefined {
  const match = /^Content-Length:\s*(\d+)$/im.exec(header);
  return match ? Number(match[1]) : undefined;
}

function headerEndIndex(bytes: Uint8Array): number {
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}
